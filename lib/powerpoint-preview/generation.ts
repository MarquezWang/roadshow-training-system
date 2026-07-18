import { randomUUID } from "node:crypto";
import { rename, rm } from "fs/promises";
import path from "path";

import { writeDiagnosticEvent } from "@/lib/diagnostic-log";
import { convertPowerPointToPdf } from "./conversion";
import { getPreviewErrorReason } from "./errors";
import { isPowerPointFile } from "./file-types";
import {
  getShortPath,
  quoteLogValue,
  warnPptPreview,
} from "./logging";
import {
  assertSafeProjectUploadPath,
  getPreviewPdfRelativePath,
} from "./paths";
import {
  acquirePreviewAttempt,
  markPreviewFailed,
  markPreviewFinalizing,
  markPreviewReady,
  readPreviewState,
} from "./repository";
import type { FileAssetForPreview, PreviewStatus } from "./types";

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
  const acquired = await acquirePreviewAttempt({
    fileId: file.id,
    attemptId,
    startedAt,
  });

  if (!acquired) {
    return readPreviewState(file.id, "预览生成任务正在执行。");
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

    const finalizing = await markPreviewFinalizing(file.id, attemptId);
    if (!finalizing) {
      return readPreviewState(file.id, "预览任务已被较新的任务取代。");
    }

    await rm(outputPath, { force: true });
    await rename(convertedPath, outputPath);

    await markPreviewReady(file.id, attemptId, outputRelativePath);

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

    await markPreviewFailed(file.id, attemptId, previewError);

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
