import { mkdir, writeFile } from "fs/promises";
import path from "path";

export const MAX_UPLOAD_SIZE = 30 * 1024 * 1024;

const ALLOWED_EXTENSIONS = new Set([".pdf", ".ppt", ".pptx", ".docx", ".txt"]);
const INITIAL_MATERIAL_EXTENSIONS = new Set([".pdf", ".ppt", ".pptx"]);

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
    throw new Error("文件大小不能超过 30MB。");
  }

  if (!isSupportedUploadFile(file.name)) {
    throw new Error("仅支持上传 PDF、PPT、PPTX、DOCX 或 TXT 文件。");
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
      "仅支持上传 1 个 PPT、PPTX 或 PDF 文件。",
    );
  }

  const file = files[0];
  const extension = path.extname(file.name).toLowerCase();

  if (!INITIAL_MATERIAL_EXTENSIONS.has(extension)) {
    throw new InitialProjectMaterialValidationError(
      "仅支持上传 1 个 PPT、PPTX 或 PDF 文件。",
    );
  }

  if (file.size > MAX_UPLOAD_SIZE) {
    throw new InitialProjectMaterialValidationError(
      "文件大小不能超过 30MB，请压缩后重新上传。",
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
  const storedName = `${Date.now()}-${safeFileName}`;
  const relativeDirectory = path.join("uploads", "projects", safeProjectId);
  const absoluteDirectory = path.join(process.cwd(), relativeDirectory);
  const relativePath = path
    .join(relativeDirectory, storedName)
    .replaceAll(path.sep, "/");
  const absolutePath = path.join(process.cwd(), relativePath);

  await mkdir(absoluteDirectory, { recursive: true });
  await writeFile(absolutePath, Buffer.from(await file.arrayBuffer()));

  return {
    originalName: file.name,
    fileType: path.extname(file.name).toLowerCase().replace(".", ""),
    filePath: relativePath,
    fileSize: file.size,
  } satisfies StoredProjectFile;
}
