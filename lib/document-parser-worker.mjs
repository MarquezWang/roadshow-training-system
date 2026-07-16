import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { parentPort, workerData } from "node:worker_threads";
import { fileURLToPath, pathToFileURL } from "node:url";

import JSZip from "jszip";

import { inspectDocumentArchive } from "./document-archive-guard.mjs";

const MAX_INPUT_BYTES = 50 * 1024 * 1024;
const MAX_EXTRACTED_TEXT_LENGTH = 100_000;
const MAX_PDF_PAGES = 500;
const MAX_SLIDE_COUNT = 500;
const MAX_SLIDE_XML_BYTES = 2 * 1024 * 1024;
const MAX_TOTAL_SLIDE_XML_BYTES = 25 * 1024 * 1024;
const SUPPORTED_FILE_TYPES = new Set(["txt", "pdf", "docx", "pptx"]);

function normalizeText(text) {
  return text.replace(/\r/g, "").replace(/[ \t]+\n/g, "\n").trim();
}

function decodeXmlText(text) {
  return text
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'");
}

function validateSignature(fileType, buffer) {
  const startsWith = (signature) =>
    buffer
      .subarray(0, signature.length)
      .equals(Buffer.from(signature, "binary"));

  if (fileType === "pdf" && !startsWith("%PDF-")) {
    throw new Error("文件内容不是有效的 PDF。");
  }
  if ((fileType === "pptx" || fileType === "docx") && !startsWith("PK\u0003\u0004")) {
    throw new Error("Office 文件结构无效。");
  }
  if (fileType === "txt" && buffer.subarray(0, 8_192).includes(0)) {
    throw new Error("TXT 文件包含二进制内容，无法解析。");
  }
}

async function parsePdf(buffer) {
  const { PDFParse } = await import("pdf-parse");
  const pdfWorkerPath = path.join(
    /* turbopackIgnore: true */ process.cwd(),
    "node_modules",
    "pdfjs-dist",
    "legacy",
    "build",
    "pdf.worker.mjs",
  );
  PDFParse.setWorker(pathToFileURL(pdfWorkerPath).href);

  const parser = new PDFParse({ data: new Uint8Array(buffer) });
  try {
    const info = await parser.getInfo();
    if (info.total > MAX_PDF_PAGES) {
      throw new Error("PDF 页数超过 500 页，已拒绝解析。");
    }
    return (await parser.getText()).text;
  } finally {
    await parser.destroy();
  }
}

async function loadOfficeArchive(buffer) {
  inspectDocumentArchive(buffer);
  return JSZip.loadAsync(buffer, {
    checkCRC32: false,
    createFolders: false,
  });
}

async function parseDocx(buffer) {
  await loadOfficeArchive(buffer);
  const mammoth = (await import("mammoth")).default;
  return (await mammoth.extractRawText({ buffer })).value;
}

async function parsePptx(buffer) {
  const zip = await loadOfficeArchive(buffer);
  const slideFiles = Object.keys(zip.files)
    .filter((fileName) => /^ppt\/slides\/slide\d+\.xml$/.test(fileName))
    .sort((left, right) =>
      left.localeCompare(right, undefined, { numeric: true }),
    );

  if (slideFiles.length > MAX_SLIDE_COUNT) {
    throw new Error("PPTX 页数超过 500 页，已拒绝解析。");
  }

  const slideTexts = [];
  let totalSlideXmlBytes = 0;
  for (const fileName of slideFiles) {
    const xmlBuffer = await zip.files[fileName].async("nodebuffer");
    if (xmlBuffer.byteLength > MAX_SLIDE_XML_BYTES) {
      throw new Error("PPTX 单页内容异常过大，已拒绝解析。");
    }
    totalSlideXmlBytes += xmlBuffer.byteLength;
    if (totalSlideXmlBytes > MAX_TOTAL_SLIDE_XML_BYTES) {
      throw new Error("PPTX 幻灯片内容解压后超过 25MB，已拒绝解析。");
    }

    const xml = xmlBuffer.toString("utf8");
    const matches = [...xml.matchAll(/<a:t>([\s\S]*?)<\/a:t>/g)];
    slideTexts.push(matches.map((match) => decodeXmlText(match[1])).join("\n"));
  }

  return slideTexts.join("\n\n");
}

export async function parseDocumentFile(inputPath, rawFileType) {
  const fileType = String(rawFileType).toLowerCase().replace(/^\./, "");
  if (!SUPPORTED_FILE_TYPES.has(fileType)) {
    throw new Error(`暂不支持解析 ${rawFileType} 文件。`);
  }

  const inputStat = await stat(/* turbopackIgnore: true */ inputPath);
  if (!inputStat.isFile() || inputStat.size <= 0) {
    throw new Error("文件不存在或为空。");
  }
  if (inputStat.size > MAX_INPUT_BYTES) {
    throw new Error("文件大小不能超过 50MB。");
  }

  const buffer = await readFile(/* turbopackIgnore: true */ inputPath);
  validateSignature(fileType, buffer);

  let extractedText = "";
  if (fileType === "txt") extractedText = buffer.toString("utf8");
  if (fileType === "pdf") extractedText = await parsePdf(buffer);
  if (fileType === "docx") extractedText = await parseDocx(buffer);
  if (fileType === "pptx") extractedText = await parsePptx(buffer);

  const normalizedText = normalizeText(extractedText);
  if (!normalizedText) {
    throw new Error("未能从文件中提取到有效文本。");
  }
  return normalizedText.slice(0, MAX_EXTRACTED_TEXT_LENGTH);
}

if (parentPort && workerData) {
  parseDocumentFile(workerData.inputPath, workerData.fileType).then(
    (text) => parentPort.postMessage({ ok: true, text }),
    (error) =>
      parentPort.postMessage({
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      }),
  );
}

const isMainProcess =
  !parentPort &&
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isMainProcess) {
  const [, , inputPath, fileType] = process.argv;
  parseDocumentFile(inputPath, fileType).then(
    (text) =>
      process.stdout.write(
        `\n__DOCUMENT_PARSER_RESULT__${JSON.stringify({ ok: true, text })}`,
      ),
    (error) =>
      process.stdout.write(
        `\n__DOCUMENT_PARSER_RESULT__${JSON.stringify({
          ok: false,
          error: error instanceof Error ? error.message : String(error),
        })}`,
      ),
  );
}
