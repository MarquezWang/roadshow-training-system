import { randomUUID } from "node:crypto";
import { mkdir, readdir, rename, rm, stat } from "fs/promises";
import path from "path";
import { pathToFileURL } from "url";

import { runBoundedProcess } from "@/lib/bounded-process.mjs";
import { createDocumentParseLimiter } from "@/lib/document-parser-boundary.mjs";
import { writeDiagnosticEvent } from "@/lib/diagnostic-log";
import { prisma } from "@/lib/prisma";

const CONVERSION_TIMEOUT_MS = 60_000;
const DETECTION_TIMEOUT_MS = 5_000;
const CONVERSION_QUEUE_TIMEOUT_MS = 60_000;
const MAX_ATTEMPT_DIRECTORY_BYTES = 150 * 1024 * 1024;
const MAX_PREVIEW_PDF_BYTES = 100 * 1024 * 1024;
const PPT_PREVIEW_LOG_PREFIX = "[PPT_PREVIEW]";
const libreOfficeLimiter = createDocumentParseLimiter(
  Number(process.env.LIBREOFFICE_MAX_CONCURRENCY) || 1,
);

type FileAssetForPreview = {
  id: string;
  projectId: string;
  originalName: string;
  fileType: string;
  filePath: string;
};

export type PreviewStatus =
  | "NONE"
  | "PENDING"
  | "FINALIZING"
  | "READY"
  | "FAILED";

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
    /*turbopackIgnore: true*/ process.cwd(),
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
  const relativePath = path.relative(
    /*turbopackIgnore: true*/ process.cwd(),
    filePath,
  );

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
      const result = await runBoundedProcess(command, ["--version"], {
        timeoutMs: DETECTION_TIMEOUT_MS,
        maxOutputBytes: 64 * 1024,
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

  const profilePath = path.join(outputDir, ".lo-profile");
  const temporaryPath = path.join(outputDir, ".lo-tmp");
  await Promise.all([
    mkdir(profilePath, { recursive: true }),
    mkdir(temporaryPath, { recursive: true }),
  ]);

  const args = [
    `-env:UserInstallation=${pathToFileURL(profilePath).href}`,
    "--headless",
    "--invisible",
    "--nologo",
    "--nodefault",
    "--nofirststartwizard",
    "--nolockcheck",
    "--norestore",
    "--convert-to",
    "pdf",
    "--outdir",
    outputDir,
    inputPath,
  ];

  const release = await libreOfficeLimiter.acquire({
    timeoutMs: CONVERSION_QUEUE_TIMEOUT_MS,
  });
  const controller = new AbortController();
  let directoryLimitExceeded = false;
  const monitor = setInterval(() => {
    void getDirectorySize(outputDir).then((size) => {
      if (size > MAX_ATTEMPT_DIRECTORY_BYTES && !controller.signal.aborted) {
        directoryLimitExceeded = true;
        controller.abort();
      }
    }).catch(() => undefined);
  }, 500);

  try {
    await runBoundedProcess(libreOffice.command, args, {
      timeoutMs: CONVERSION_TIMEOUT_MS,
      maxOutputBytes: 512 * 1024,
      signal: controller.signal,
      env: {
        ...process.env,
        HOME: temporaryPath,
        TEMP: temporaryPath,
        TMP: temporaryPath,
        SAL_DISABLE_OPENCL: "1",
        SAL_USE_VCLPLUGIN: "svp",
        http_proxy: "http://127.0.0.1:9",
        https_proxy: "http://127.0.0.1:9",
        HTTP_PROXY: "http://127.0.0.1:9",
        HTTPS_PROXY: "http://127.0.0.1:9",
        ALL_PROXY: "http://127.0.0.1:9",
        all_proxy: "http://127.0.0.1:9",
        NO_PROXY: "",
        no_proxy: "",
      },
    });
  } catch (error) {
    throw new PowerPointPreviewError(
      "libreoffice_execution_failed",
      directoryLimitExceeded
        ? "PPT 展示预览生成失败：临时文件超过 150MB，已终止转换。"
        : `PPT 展示预览生成失败：${sanitizeLogValue(getErrorMessage(error))}`,
    );
  } finally {
    clearInterval(monitor);
    controller.abort();
    release();
    await Promise.all([
      rm(profilePath, { recursive: true, force: true }),
      rm(temporaryPath, { recursive: true, force: true }),
    ]).catch(() => undefined);
  }
}

async function getDirectorySize(directoryPath: string): Promise<number> {
  let total = 0;
  const entries = await readdir(directoryPath, { withFileTypes: true });
  for (const entry of entries) {
    const entryPath = path.join(directoryPath, entry.name);
    if (entry.isDirectory()) {
      total += await getDirectorySize(entryPath);
    } else if (entry.isFile()) {
      total += (await stat(entryPath)).size;
    }
    if (total > MAX_ATTEMPT_DIRECTORY_BYTES) return total;
  }
  return total;
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
    if (
      !convertedStat.isFile() ||
      convertedStat.size === 0 ||
      convertedStat.size > MAX_PREVIEW_PDF_BYTES
    ) {
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

  const attemptId = randomUUID();
  const startedAt = new Date();
  const staleBefore = new Date(
    startedAt.getTime() - Math.max(CONVERSION_TIMEOUT_MS * 2, 120_000),
  );
  const acquisition = await prisma.fileAsset.updateMany({
    where: {
      id: file.id,
      OR: [
        { previewStatus: { notIn: ["PENDING", "FINALIZING"] } },
        { previewStartedAt: null },
        { previewStartedAt: { lt: staleBefore } },
      ],
    },
    data: {
      previewStatus: "PENDING",
      previewError: null,
      previewAttemptId: attemptId,
      previewStartedAt: startedAt,
    },
  });

  if (acquisition.count === 0) {
    const current = await prisma.fileAsset.findUnique({
      where: { id: file.id },
      select: {
        previewStatus: true,
        previewPdfPath: true,
        previewError: true,
      },
    });
    return {
      previewStatus: (current?.previewStatus ?? "FAILED") as PreviewStatus,
      previewPdfPath: current?.previewPdfPath ?? null,
      previewError: current?.previewError ?? "预览生成任务正在执行。",
    };
  }

  let attemptOutputDir: string | null = null;
  try {
    const inputPath = assertSafeProjectUploadPath(file.filePath);
    const outputRelativePath = getPreviewPdfRelativePath(
      file.projectId,
      file.id,
    );
    const outputPath = path.resolve(
      /*turbopackIgnore: true*/ process.cwd(),
      outputRelativePath,
    );
    const outputDir = path.dirname(outputPath);
    attemptOutputDir = path.join(outputDir, `.attempt-${attemptId}`);
    const convertedPath = await convertPowerPointToPdf(
      inputPath,
      attemptOutputDir,
    );

    const finalizing = await prisma.fileAsset.updateMany({
      where: {
        id: file.id,
        previewAttemptId: attemptId,
        previewStatus: "PENDING",
      },
      data: { previewStatus: "FINALIZING" },
    });
    if (finalizing.count === 0) {
      const current = await prisma.fileAsset.findUnique({
        where: { id: file.id },
        select: {
          previewStatus: true,
          previewPdfPath: true,
          previewError: true,
        },
      });
      return {
        previewStatus: (current?.previewStatus ?? "FAILED") as PreviewStatus,
        previewPdfPath: current?.previewPdfPath ?? null,
        previewError: current?.previewError ?? "预览任务已被较新的任务取代。",
      };
    }

    await rm(outputPath, { force: true });
    await rename(convertedPath, outputPath);

    await prisma.fileAsset.updateMany({
      where: {
        id: file.id,
        previewAttemptId: attemptId,
        previewStatus: "FINALIZING",
      },
      data: {
        previewPdfPath: outputRelativePath,
        previewStatus: "READY",
        previewError: null,
        previewAttemptId: null,
        previewStartedAt: null,
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
    void writeDiagnosticEvent({
      type: "PPT_PREVIEW_ERROR",
      message: previewError,
      meta: {
        reason: getPreviewErrorReason(error),
        fileType: file.fileType,
        file: getShortPath(file.filePath),
      },
    });

    await prisma.fileAsset.updateMany({
      where: {
        id: file.id,
        previewAttemptId: attemptId,
        previewStatus: { in: ["PENDING", "FINALIZING"] },
      },
      data: {
        previewPdfPath: null,
        previewStatus: "FAILED",
        previewError,
        previewAttemptId: null,
        previewStartedAt: null,
      },
    });

    return {
      previewStatus: "FAILED" as PreviewStatus,
      previewPdfPath: null,
      previewError,
    };
  } finally {
    if (attemptOutputDir) {
      await rm(attemptOutputDir, { recursive: true, force: true }).catch(
        () => undefined,
      );
    }
  }
}
