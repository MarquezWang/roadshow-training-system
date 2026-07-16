const END_OF_CENTRAL_DIRECTORY_SIGNATURE = 0x06054b50;
const CENTRAL_DIRECTORY_ENTRY_SIGNATURE = 0x02014b50;
const MAX_EOCD_SEARCH_BYTES = 65_557;

export const DEFAULT_DOCUMENT_ARCHIVE_LIMITS = Object.freeze({
  maxEntries: 5_000,
  maxTotalUncompressedBytes: 100 * 1024 * 1024,
  maxEntryUncompressedBytes: 50 * 1024 * 1024,
  maxXmlEntryBytes: 5 * 1024 * 1024,
  maxTotalXmlBytes: 30 * 1024 * 1024,
  maxCompressionRatio: 200,
  maxFileNameBytes: 1_024,
});

export class DocumentArchiveLimitError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "DocumentArchiveLimitError";
    this.code = code;
  }
}

function fail(code, message) {
  throw new DocumentArchiveLimitError(code, message);
}

function findEndOfCentralDirectory(buffer) {
  const lowerBound = Math.max(0, buffer.length - MAX_EOCD_SEARCH_BYTES);
  for (let offset = buffer.length - 22; offset >= lowerBound; offset -= 1) {
    if (buffer.readUInt32LE(offset) === END_OF_CENTRAL_DIRECTORY_SIGNATURE) {
      const commentLength = buffer.readUInt16LE(offset + 20);
      if (offset + 22 + commentLength === buffer.length) return offset;
    }
  }

  fail("INVALID_ARCHIVE", "Office 文件缺少有效的 ZIP 中央目录。");
}

function decodeFileName(bytes, utf8) {
  return bytes.toString(utf8 ? "utf8" : "latin1").replaceAll("\\", "/");
}

function assertSafeEntryName(fileName) {
  if (
    fileName.startsWith("/") ||
    /^[a-zA-Z]:\//.test(fileName) ||
    fileName.split("/").some((segment) => segment === "..") ||
    fileName.includes("\0")
  ) {
    fail("UNSAFE_ENTRY_PATH", "Office 文件包含不安全的内部路径。");
  }
}

export function inspectDocumentArchive(buffer, customLimits = {}) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 22) {
    fail("INVALID_ARCHIVE", "Office 文件结构无效。");
  }

  const limits = { ...DEFAULT_DOCUMENT_ARCHIVE_LIMITS, ...customLimits };
  const eocdOffset = findEndOfCentralDirectory(buffer);
  const diskNumber = buffer.readUInt16LE(eocdOffset + 4);
  const centralDirectoryDisk = buffer.readUInt16LE(eocdOffset + 6);
  const entriesOnDisk = buffer.readUInt16LE(eocdOffset + 8);
  const totalEntries = buffer.readUInt16LE(eocdOffset + 10);
  const centralDirectoryBytes = buffer.readUInt32LE(eocdOffset + 12);
  const centralDirectoryOffset = buffer.readUInt32LE(eocdOffset + 16);

  if (
    diskNumber !== 0 ||
    centralDirectoryDisk !== 0 ||
    entriesOnDisk !== totalEntries
  ) {
    fail("MULTI_DISK_ARCHIVE", "不支持分卷 Office 文件。");
  }
  if (
    totalEntries === 0xffff ||
    centralDirectoryBytes === 0xffffffff ||
    centralDirectoryOffset === 0xffffffff
  ) {
    fail("ZIP64_ARCHIVE", "不支持 ZIP64 Office 文件。");
  }
  if (totalEntries > limits.maxEntries) {
    fail("TOO_MANY_ENTRIES", "Office 文件包含过多内部条目，已拒绝解析。");
  }
  if (
    centralDirectoryOffset + centralDirectoryBytes > eocdOffset ||
    centralDirectoryOffset < 0
  ) {
    fail("INVALID_ARCHIVE", "Office 文件中央目录越界。");
  }

  let offset = centralDirectoryOffset;
  let totalUncompressedBytes = 0;
  let totalXmlBytes = 0;
  const entries = [];

  for (let index = 0; index < totalEntries; index += 1) {
    if (
      offset + 46 > buffer.length ||
      buffer.readUInt32LE(offset) !== CENTRAL_DIRECTORY_ENTRY_SIGNATURE
    ) {
      fail("INVALID_ARCHIVE", "Office 文件中央目录条目无效。");
    }

    const flags = buffer.readUInt16LE(offset + 8);
    const compressionMethod = buffer.readUInt16LE(offset + 10);
    const compressedSize = buffer.readUInt32LE(offset + 20);
    const uncompressedSize = buffer.readUInt32LE(offset + 24);
    const fileNameLength = buffer.readUInt16LE(offset + 28);
    const extraLength = buffer.readUInt16LE(offset + 30);
    const commentLength = buffer.readUInt16LE(offset + 32);
    const entryBytes = 46 + fileNameLength + extraLength + commentLength;

    if (offset + entryBytes > buffer.length) {
      fail("INVALID_ARCHIVE", "Office 文件中央目录条目越界。");
    }
    if (fileNameLength > limits.maxFileNameBytes) {
      fail("FILE_NAME_TOO_LONG", "Office 文件包含过长的内部文件名。");
    }
    if ((flags & 0x1) !== 0) {
      fail("ENCRYPTED_ENTRY", "不支持包含加密条目的 Office 文件。");
    }
    if (compressionMethod !== 0 && compressionMethod !== 8) {
      fail("UNSUPPORTED_COMPRESSION", "Office 文件使用了不支持的压缩方式。");
    }
    if (compressedSize === 0xffffffff || uncompressedSize === 0xffffffff) {
      fail("ZIP64_ARCHIVE", "不支持 ZIP64 Office 文件。");
    }

    const fileName = decodeFileName(
      buffer.subarray(offset + 46, offset + 46 + fileNameLength),
      (flags & 0x800) !== 0,
    );
    assertSafeEntryName(fileName);

    const isDirectory = fileName.endsWith("/");
    if (!isDirectory) {
      if (uncompressedSize > limits.maxEntryUncompressedBytes) {
        fail("ENTRY_TOO_LARGE", "Office 文件的单个内部条目过大。");
      }
      if (
        uncompressedSize > 1024 * 1024 &&
        (compressedSize === 0 ||
          uncompressedSize / compressedSize > limits.maxCompressionRatio)
      ) {
        fail("SUSPICIOUS_COMPRESSION_RATIO", "Office 文件压缩比异常，已拒绝解析。");
      }

      totalUncompressedBytes += uncompressedSize;
      if (totalUncompressedBytes > limits.maxTotalUncompressedBytes) {
        fail("ARCHIVE_TOO_LARGE", "Office 文件解压后体积超过 100MB，已拒绝解析。");
      }

      if (/\.xml$/i.test(fileName)) {
        if (uncompressedSize > limits.maxXmlEntryBytes) {
          fail("XML_ENTRY_TOO_LARGE", "Office 文件的单个 XML 内容异常过大。");
        }
        totalXmlBytes += uncompressedSize;
        if (totalXmlBytes > limits.maxTotalXmlBytes) {
          fail("XML_TOTAL_TOO_LARGE", "Office 文件的 XML 内容总量异常过大。");
        }
      }
    }

    entries.push({ fileName, compressedSize, uncompressedSize, isDirectory });
    offset += entryBytes;
  }

  if (offset > centralDirectoryOffset + centralDirectoryBytes) {
    fail("INVALID_ARCHIVE", "Office 文件中央目录长度无效。");
  }

  return {
    entryCount: totalEntries,
    totalUncompressedBytes,
    totalXmlBytes,
    entries,
  };
}
