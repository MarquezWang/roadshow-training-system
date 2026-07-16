import { access } from "fs/promises";
import path from "path";
import {
  runDocumentParserWorker,
  withTemporaryDocumentFile,
} from "@/lib/document-parser-boundary.mjs";
import {
  validateProjectFileSignature,
  validateProjectUpload,
} from "@/lib/file-upload";

const SUPPORTED_FILE_TYPES = new Set(["txt", "pdf", "docx", "pptx"]);

async function resolveUploadPath(filePath: string) {
  const normalizedPath = filePath.replaceAll("\\", "/");
  const uploadPrefix = "uploads/projects/";

  if (!normalizedPath.startsWith(uploadPrefix)) {
    throw new Error("文件路径不在允许的 uploads/projects 目录下。");
  }

  const projectsUploadsRoot = path.join(
    /* turbopackIgnore: true */ process.cwd(),
    "uploads",
    "projects",
  );
  const absolutePath = path.resolve(
    projectsUploadsRoot,
    normalizedPath.slice(uploadPrefix.length),
  );
  const relativeToProjectsUploads = path.relative(
    projectsUploadsRoot,
    absolutePath,
  );

  if (
    relativeToProjectsUploads.startsWith("..") ||
    path.isAbsolute(relativeToProjectsUploads)
  ) {
    throw new Error("文件路径不在允许的 uploads/projects 目录下。");
  }

  await access(/* turbopackIgnore: true */ absolutePath);
  return absolutePath;
}

function normalizeFileType(fileType: string) {
  const normalizedType = fileType.toLowerCase().replace(/^\./, "");

  if (!SUPPORTED_FILE_TYPES.has(normalizedType)) {
    throw new Error(`暂不支持解析 ${fileType} 文件。`);
  }
  return normalizedType;
}

export async function parseUploadedFileToText(file: File) {
  validateProjectUpload(file);
  const fileType = normalizeFileType(path.extname(file.name));
  const buffer = Buffer.from(await file.arrayBuffer());
  validateProjectFileSignature(file.name, buffer);

  return withTemporaryDocumentFile(buffer, fileType, (temporaryPath: string) =>
    runDocumentParserWorker({ inputPath: temporaryPath, fileType }),
  );
}

export async function parseFileToText(filePath: string, fileType: string) {
  let absolutePath: string;

  try {
    absolutePath = await resolveUploadPath(filePath);
  } catch (error) {
    if (error instanceof Error) {
      throw new Error(`文件不存在或不可读取：${error.message}`);
    }

    throw new Error("文件不存在或不可读取。");
  }

  return runDocumentParserWorker({
    inputPath: absolutePath,
    fileType: normalizeFileType(fileType),
  });
}
