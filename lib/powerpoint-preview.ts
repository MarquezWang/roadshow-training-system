import { execFile } from "child_process";
import { mkdir, rename, rm, stat } from "fs/promises";
import path from "path";
import { promisify } from "util";

import { prisma } from "@/lib/prisma";

const execFileAsync = promisify(execFile);
const CONVERSION_TIMEOUT_MS = 60_000;

type FileAssetForPreview = {
  id: string;
  projectId: string;
  originalName: string;
  fileType: string;
  filePath: string;
};

export type PreviewStatus = "NONE" | "PENDING" | "READY" | "FAILED";

export function isPowerPointFile(file: { fileType: string; originalName?: string }) {
  const normalizedType = file.fileType.toLowerCase().replace(/^\./, "");
  if (normalizedType === "ppt" || normalizedType === "pptx") {
    return true;
  }

  const extension = path.extname(file.originalName ?? "").toLowerCase();
  return extension === ".ppt" || extension === ".pptx";
}

export function isPdfFile(file: { fileType: string; originalName?: string }) {
  const normalizedType = file.fileType.toLowerCase().replace(/^\./, "");
  if (normalizedType === "pdf") {
    return true;
  }

  return path.extname(file.originalName ?? "").toLowerCase() === ".pdf";
}

function sanitizePathSegment(segment: string) {
  return segment.replace(/[^a-zA-Z0-9_-]/g, "");
}

function assertSafeProjectUploadPath(filePath: string) {
  const normalizedPath = filePath.replaceAll("\\", "/");
  const uploadPrefix = "uploads/projects/";

  if (!normalizedPath.startsWith(uploadPrefix)) {
    throw new Error("INVALID_UPLOAD_PATH");
  }

  const projectsUploadsRoot = path.resolve(
    process.cwd(),
    "uploads",
    "projects",
  );
  const relativeProjectPath = normalizedPath.slice(uploadPrefix.length);
  const absolutePath = path.resolve(projectsUploadsRoot, relativeProjectPath);
  const relativeToProjectsUploads = path.relative(
    projectsUploadsRoot,
    absolutePath,
  );

  if (
    relativeToProjectsUploads.startsWith("..") ||
    path.isAbsolute(relativeToProjectsUploads)
  ) {
    throw new Error("INVALID_UPLOAD_PATH");
  }

  return absolutePath;
}

function getLibreOfficeCandidates() {
  return [
    process.env.LIBREOFFICE_PATH,
    "libreoffice",
    "soffice",
    "soffice.exe",
  ].filter((value): value is string => Boolean(value));
}

async function runLibreOfficeConvert(inputPath: string, outputDir: string) {
  const args = [
    "--headless",
    "--nologo",
    "--nofirststartwizard",
    "--convert-to",
    "pdf",
    "--outdir",
    outputDir,
    inputPath,
  ];
  const errors: string[] = [];

  for (const command of getLibreOfficeCandidates()) {
    try {
      await execFileAsync(command, args, {
        timeout: CONVERSION_TIMEOUT_MS,
        windowsHide: true,
      });
      return;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      errors.push(`${command}: ${message}`);
    }
  }

  const noExecutable = errors.every((message) =>
    /ENOENT|not recognized|找不到|无法将/.test(message),
  );

  if (noExecutable) {
    throw new Error("当前环境未配置 PPT 转换组件（LibreOffice）。");
  }

  throw new Error(`PPT 展示预览生成失败：${errors.join("；")}`);
}

export async function convertPowerPointToPdf(
  inputPath: string,
  outputDir: string,
) {
  await mkdir(outputDir, { recursive: true });
  await runLibreOfficeConvert(inputPath, outputDir);

  const inputExtension = path.extname(inputPath);
  const convertedPath = path.join(
    outputDir,
    `${path.basename(inputPath, inputExtension)}.pdf`,
  );

  const convertedStat = await stat(convertedPath);
  if (!convertedStat.isFile() || convertedStat.size === 0) {
    throw new Error("PPT 展示预览生成失败：未找到转换后的 PDF 文件。");
  }

  return convertedPath;
}

export function getPreviewPdfRelativePath(projectId: string, fileId: string) {
  return path
    .join(
      "uploads",
      "projects",
      sanitizePathSegment(projectId),
      "previews",
      `${sanitizePathSegment(fileId) || "preview"}.pdf`,
    )
    .replaceAll(path.sep, "/");
}

export async function generatePowerPointPreviewPdf(file: FileAssetForPreview) {
  if (!isPowerPointFile(file)) {
    return {
      previewStatus: "NONE" as PreviewStatus,
      previewPdfPath: null,
      previewError: null,
    };
  }

  await prisma.fileAsset.update({
    where: {
      id: file.id,
    },
    data: {
      previewStatus: "PENDING",
      previewError: null,
    },
  });

  try {
    const inputPath = assertSafeProjectUploadPath(file.filePath);
    const outputRelativePath = getPreviewPdfRelativePath(
      file.projectId,
      file.id,
    );
    const outputPath = path.resolve(process.cwd(), outputRelativePath);
    const outputDir = path.dirname(outputPath);
    const convertedPath = await convertPowerPointToPdf(inputPath, outputDir);

    if (convertedPath !== outputPath) {
      await rm(outputPath, { force: true });
      await rename(convertedPath, outputPath);
    }

    await prisma.fileAsset.update({
      where: {
        id: file.id,
      },
      data: {
        previewPdfPath: outputRelativePath,
        previewStatus: "READY",
        previewError: null,
      },
    });

    return {
      previewStatus: "READY" as PreviewStatus,
      previewPdfPath: outputRelativePath,
      previewError: null,
    };
  } catch (error) {
    const previewError =
      error instanceof Error ? error.message : "PPT 展示预览生成失败。";

    await prisma.fileAsset.update({
      where: {
        id: file.id,
      },
      data: {
        previewPdfPath: null,
        previewStatus: "FAILED",
        previewError,
      },
    });

    return {
      previewStatus: "FAILED" as PreviewStatus,
      previewPdfPath: null,
      previewError,
    };
  }
}
