import { execFile } from "child_process";
import { mkdir, rename, rm, stat } from "fs/promises";
import path from "path";
import { promisify } from "util";

import { prisma } from "@/lib/prisma";

const execFileAsync = promisify(execFile);
const CONVERSION_TIMEOUT_MS = 60_000;
const DETECTION_TIMEOUT_MS = 5_000;
const PPT_PREVIEW_LOG_PREFIX = "[PPT_PREVIEW]";

type FileAssetForPreview = {
  id: string;
  projectId: string;
  originalName: string;
  fileType: string;
  filePath: string;
};

export type PreviewStatus = "NONE" | "PENDING" | "READY" | "FAILED";

type LibreOfficeCheckResult =
  | {
      available: true;
      command: string;
      version: string;
    }
  | {
      available: false;
      reason: string;
      errors: string[];
    };

class PowerPointPreviewError extends Error {
  constructor(
    readonly reason:
      | "libreoffice_unavailable"
      | "libreoffice_execution_failed"
      | "input_file_not_found"
      | "output_pdf_not_generated"
      | "unknown",
    message: string,
  ) {
    super(message);
    this.name = "PowerPointPreviewError";
  }
}

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

function isCommandNotFoundError(message: string) {
  return /ENOENT|not recognized|找不到|无法将|not found/i.test(message);
}

function sanitizeLogValue(value: string, maxLength = 200) {
  return value.replace(/\s+/g, " ").trim().slice(0, maxLength);
}

function quoteLogValue(value: string) {
  return `"${sanitizeLogValue(value).replaceAll('"', "'")}"`;
}

function getShortPath(filePath: string) {
  const relativePath = path.relative(process.cwd(), filePath);

  if (!relativePath.startsWith("..") && !path.isAbsolute(relativePath)) {
    return relativePath.replaceAll(path.sep, "/");
  }

  return path.basename(filePath);
}

function logPptPreview(message: string) {
  console.log(`${PPT_PREVIEW_LOG_PREFIX} ${message}`);
}

function warnPptPreview(message: string) {
  console.warn(`${PPT_PREVIEW_LOG_PREFIX} ${message}`);
}

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

function getPreviewErrorReason(error: unknown) {
  if (error instanceof PowerPointPreviewError) {
    return error.reason;
  }

  return "unknown";
}

export async function checkLibreOfficeAvailability(): Promise<LibreOfficeCheckResult> {
  const errors: string[] = [];

  for (const command of getLibreOfficeCandidates()) {
    try {
      const result = await execFileAsync(command, ["--version"], {
        timeout: DETECTION_TIMEOUT_MS,
        windowsHide: true,
      });
      const version = sanitizeLogValue(
        result.stdout || result.stderr || "version unavailable",
      );

      logPptPreview(
        `libreoffice found command=${command} version=${quoteLogValue(
          version,
        )}`,
      );

      return {
        available: true,
        command,
        version,
      };
    } catch (error) {
      errors.push(`${command}: ${sanitizeLogValue(getErrorMessage(error))}`);
    }
  }

  const reason = errors.every(isCommandNotFoundError)
    ? "command not found"
    : sanitizeLogValue(errors.join("; "));
  warnPptPreview(`libreoffice unavailable reason=${quoteLogValue(reason)}`);

  return {
    available: false,
    reason,
    errors,
  };
}

async function runLibreOfficeConvert(inputPath: string, outputDir: string) {
  const libreOffice = await checkLibreOfficeAvailability();

  if (!libreOffice.available) {
    throw new PowerPointPreviewError(
      "libreoffice_unavailable",
      "当前环境未配置 PPT 转换组件（LibreOffice）。",
    );
  }

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

  try {
    await execFileAsync(libreOffice.command, args, {
      timeout: CONVERSION_TIMEOUT_MS,
      windowsHide: true,
    });
  } catch (error) {
    throw new PowerPointPreviewError(
      "libreoffice_execution_failed",
      `PPT 展示预览生成失败：${sanitizeLogValue(getErrorMessage(error))}`,
    );
  }
}

export async function convertPowerPointToPdf(
  inputPath: string,
  outputDir: string,
) {
  await mkdir(outputDir, { recursive: true });

  try {
    const inputStat = await stat(inputPath);

    if (!inputStat.isFile()) {
      throw new PowerPointPreviewError(
        "input_file_not_found",
        "PPT 展示预览生成失败：输入文件不存在。",
      );
    }
  } catch (error) {
    if (error instanceof PowerPointPreviewError) {
      throw error;
    }

    throw new PowerPointPreviewError(
      "input_file_not_found",
      "PPT 展示预览生成失败：输入文件不存在。",
    );
  }

  await runLibreOfficeConvert(inputPath, outputDir);

  const inputExtension = path.extname(inputPath);
  const convertedPath = path.join(
    outputDir,
    `${path.basename(inputPath, inputExtension)}.pdf`,
  );

  try {
    const convertedStat = await stat(convertedPath);
    if (!convertedStat.isFile() || convertedStat.size === 0) {
      throw new PowerPointPreviewError(
        "output_pdf_not_generated",
        "PPT 展示预览生成失败：未找到转换后的 PDF 文件。",
      );
    }
  } catch (error) {
    if (error instanceof PowerPointPreviewError) {
      throw error;
    }

    throw new PowerPointPreviewError(
      "output_pdf_not_generated",
      "PPT 展示预览生成失败：未找到转换后的 PDF 文件。",
    );
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
    warnPptPreview(
      `convert failed reason=${quoteLogValue(
        getPreviewErrorReason(error),
      )} file=${quoteLogValue(getShortPath(file.filePath))}`,
    );

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
