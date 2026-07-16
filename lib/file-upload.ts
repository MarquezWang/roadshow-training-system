import { randomUUID } from "node:crypto";
import { mkdir, rename, rm, writeFile } from "fs/promises";
import path from "path";

export const MAX_UPLOAD_SIZE = 50 * 1024 * 1024;

const ALLOWED_EXTENSIONS = new Set([".pdf", ".pptx", ".docx", ".txt"]);
const INITIAL_MATERIAL_EXTENSIONS = new Set([".pdf", ".pptx"]);

export type StoredProjectFile = {
  originalName: string;
  fileType: string;
  filePath: string;
  fileSize: number;
};

export function formatFileSize(size: number) {
  if (size >= 1024 * 1024) {
    return `${(size / 1024 / 1024).toFixed(2)} MB`;
  }

  return `${Math.max(1, Math.ceil(size / 1024))} KB`;
}

export function isSupportedUploadFile(fileName: string) {
  return ALLOWED_EXTENSIONS.has(path.extname(fileName).toLowerCase());
}

export function validateProjectUpload(file: File) {
  if (!file || file.size === 0) {
    throw new Error("请选择需要上传的文件。");
  }

  if (file.size > MAX_UPLOAD_SIZE) {
    throw new Error("文件大小不能超过 50MB。");
  }

  if (!isSupportedUploadFile(file.name)) {
    throw new Error("仅支持上传 PDF、PPTX、DOCX 或 TXT 文件。");
  }
}

export class InitialProjectMaterialValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InitialProjectMaterialValidationError";
  }
}

export function validateInitialProjectMaterial(files: File[]) {
  if (files.length !== 1 || files[0].size === 0) {
    throw new InitialProjectMaterialValidationError(
      "仅支持上传 1 个 PPTX 或 PDF 文件。",
    );
  }

  const file = files[0];
  const extension = path.extname(file.name).toLowerCase();

  if (!INITIAL_MATERIAL_EXTENSIONS.has(extension)) {
    throw new InitialProjectMaterialValidationError(
      "仅支持上传 1 个 PPTX 或 PDF 文件。",
    );
  }

  if (file.size > MAX_UPLOAD_SIZE) {
    throw new InitialProjectMaterialValidationError(
      "文件大小不能超过 50MB，请压缩后重新上传。",
    );
  }

  return file;
}

function sanitizeProjectId(projectId: string) {
  return projectId.replace(/[^a-zA-Z0-9_-]/g, "");
}

function sanitizeFileName(fileName: string) {
  const baseName = path.basename(fileName);
  const extension = path.extname(baseName).toLowerCase();
  const nameWithoutExtension = path.basename(baseName, extension);
  const safeName =
    nameWithoutExtension
      .normalize("NFKD")
      .replace(/[^a-zA-Z0-9_-]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 80) || "file";

  return `${safeName}${extension}`;
}

export async function saveProjectUpload(projectId: string, file: File) {
  validateProjectUpload(file);

  const safeProjectId = sanitizeProjectId(projectId);
  const safeFileName = sanitizeFileName(file.name);
  const storedName = `${randomUUID()}-${safeFileName}`;
  const relativeDirectory = path.join("uploads", "projects", safeProjectId);
  const absoluteDirectory = path.join(
    /* turbopackIgnore: true */ process.cwd(),
    relativeDirectory,
  );
  const relativePath = path
    .join(relativeDirectory, storedName)
    .replaceAll(path.sep, "/");
  const absolutePath = path.join(
    /* turbopackIgnore: true */ process.cwd(),
    relativePath,
  );
  const temporaryPath = `${absolutePath}.${randomUUID()}.tmp`;
  const buffer = Buffer.from(await file.arrayBuffer());

  validateProjectFileSignature(file.name, buffer);

  await mkdir(absoluteDirectory, { recursive: true });
  try {
    await writeFile(/* turbopackIgnore: true */ temporaryPath, buffer, {
      flag: "wx",
    });
    await rename(
      /* turbopackIgnore: true */ temporaryPath,
      /* turbopackIgnore: true */ absolutePath,
    );
  } catch (error) {
    await rm(temporaryPath, { force: true }).catch(() => undefined);
    throw error;
  }

  return {
    originalName: file.name,
    fileType: path.extname(file.name).toLowerCase().replace(".", ""),
    filePath: relativePath,
    fileSize: file.size,
  } satisfies StoredProjectFile;
}

export function validateProjectFileSignature(fileName: string, buffer: Buffer) {
  const extension = path.extname(fileName).toLowerCase();
  const startsWith = (signature: string) =>
    buffer.subarray(0, signature.length).equals(Buffer.from(signature, "binary"));

  if (extension === ".pdf" && !startsWith("%PDF-")) {
    throw new Error("文件内容不是有效的 PDF。请勿仅修改文件扩展名。");
  }

  if (
    (extension === ".pptx" || extension === ".docx") &&
    !startsWith("PK\u0003\u0004")
  ) {
    throw new Error("Office 文件结构无效。请重新导出后上传。");
  }

  if (extension === ".txt" && buffer.subarray(0, 8_192).includes(0)) {
    throw new Error("TXT 文件包含二进制内容，无法解析。");
  }
}

export async function removeProjectUpload(filePath: string) {
  const uploadRoot = path.resolve(
    /* turbopackIgnore: true */ process.cwd(),
    "uploads",
    "projects",
  );
  const absolutePath = path.resolve(
    /* turbopackIgnore: true */ process.cwd(),
    filePath,
  );
  const relativePath = path.relative(uploadRoot, absolutePath);

  if (relativePath.startsWith("..") || path.isAbsolute(relativePath)) {
    throw new Error("拒绝删除项目上传目录之外的文件。");
  }

  await rm(/* turbopackIgnore: true */ absolutePath, { force: true });
}
