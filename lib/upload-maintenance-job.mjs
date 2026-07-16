import { randomUUID } from "node:crypto";
import path from "node:path";

import { scanUploadTree } from "./upload-orphan-scan.mjs";

export const UPLOAD_MAINTENANCE_JOB_TYPE = "UPLOAD_MAINTENANCE";
export const UPLOAD_MAINTENANCE_JOB_KEY = "upload-maintenance:global";
const DEFAULT_LEASE_MS = 10 * 60_000;
const DEFAULT_MISSING_REFERENCE_GRACE_MS = 10 * 60_000;
const TRANSCRIPTION_JOB_TYPE = "TRAINING_TRANSCRIPTION";

function positiveNumber(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function normalizedStoredPath(value) {
  return String(value).replaceAll("\\", "/").replace(/^\.\//, "");
}

async function acquireMaintenanceJob(client, {
  jobKey,
  now,
  leaseMs,
}) {
  const ownerToken = randomUUID();
  const leaseExpiresAt = new Date(now.getTime() + leaseMs);
  return client.$transaction(async (transaction) => {
    const existing = await transaction.asyncJob.findUnique({ where: { jobKey } });
    if (
      existing?.status === "RUNNING" &&
      existing.leaseExpiresAt &&
      existing.leaseExpiresAt > now
    ) {
      return null;
    }
    if (existing) {
      await transaction.asyncJob.update({
        where: { id: existing.id },
        data: {
          status: "RUNNING",
          ownerToken,
          leaseExpiresAt,
          nextAttemptAt: null,
          attempt: { increment: 1 },
          errorMessage: null,
        },
      });
    } else {
      await transaction.asyncJob.create({
        data: {
          jobKey,
          jobType: UPLOAD_MAINTENANCE_JOB_TYPE,
          resourceId: "uploads",
          status: "RUNNING",
          ownerToken,
          leaseExpiresAt,
          attempt: 1,
          maxAttempts: 1,
        },
      });
    }
    return ownerToken;
  });
}

async function releaseMaintenanceJob(client, {
  jobKey,
  ownerToken,
  status,
  errorMessage = null,
}) {
  return client.asyncJob.updateMany({
    where: { jobKey, ownerToken, status: "RUNNING" },
    data: {
      status,
      leaseExpiresAt: null,
      nextAttemptAt: null,
      errorMessage: errorMessage?.slice(0, 500) ?? null,
    },
  });
}

async function reconcileMissingReferences(client, {
  files,
  recordings,
  report,
  now,
  graceMs,
}) {
  const missing = new Set(report.missingReferences.map(normalizedStoredPath));
  const unsafe = new Set(report.unsafeReferences.map(normalizedStoredPath));
  const cutoff = new Date(now.getTime() - graceMs);
  let missingSourceFiles = 0;
  let missingPreviews = 0;
  let missingRecordings = 0;

  for (const file of files) {
    if (file.updatedAt > cutoff) continue;
    const sourceUnavailable =
      missing.has(normalizedStoredPath(file.filePath)) ||
      unsafe.has(normalizedStoredPath(file.filePath));
    const previewUnavailable =
      file.previewPdfPath &&
      (missing.has(normalizedStoredPath(file.previewPdfPath)) ||
        unsafe.has(normalizedStoredPath(file.previewPdfPath)));

    if (sourceUnavailable) {
      const result = await client.fileAsset.updateMany({
        where: { id: file.id, filePath: file.filePath },
        data: {
          parseStatus: "FAILED",
          parseError: "材料源文件丢失，请重新上传。",
        },
      });
      missingSourceFiles += result.count;
    }
    if (previewUnavailable) {
      const result = await client.fileAsset.updateMany({
        where: { id: file.id, previewPdfPath: file.previewPdfPath },
        data: {
          previewPdfPath: null,
          previewStatus: "FAILED",
          previewError: "PPT 预览文件丢失，请重新生成预览。",
        },
      });
      missingPreviews += result.count;
    }
  }

  for (const recording of recordings) {
    if (recording.updatedAt > cutoff) continue;
    const recordingUnavailable =
      missing.has(normalizedStoredPath(recording.filePath)) ||
      unsafe.has(normalizedStoredPath(recording.filePath));
    if (!recordingUnavailable) continue;

    const result = await client.trainingRecording.updateMany({
      where: { id: recording.id, filePath: recording.filePath },
      data: { status: "MISSING" },
    });
    missingRecordings += result.count;
    await Promise.all([
      client.trainingTranscript.updateMany({
        where: {
          recordingId: recording.id,
          status: { in: ["PENDING", "PROCESSING"] },
        },
        data: {
          status: "FAILED",
          errorMessage: "录音文件丢失，无法继续转写。",
          completedAt: now,
        },
      }),
      client.asyncJob.updateMany({
        where: {
          jobType: TRANSCRIPTION_JOB_TYPE,
          resourceId: recording.id,
          status: { in: ["PENDING", "RETRY_WAIT", "RUNNING"] },
        },
        data: {
          status: "FAILED",
          leaseExpiresAt: null,
          nextAttemptAt: null,
          errorMessage: "录音文件丢失。",
        },
      }),
    ]);
  }

  return { missingSourceFiles, missingPreviews, missingRecordings };
}

export async function runUploadMaintenancePass(client, {
  workspaceRoot = /* turbopackIgnore: true */ process.cwd(),
  jobKey = UPLOAD_MAINTENANCE_JOB_KEY,
  now = new Date(),
  leaseMs = DEFAULT_LEASE_MS,
  missingReferenceGraceMs = DEFAULT_MISSING_REFERENCE_GRACE_MS,
  deleteStale = true,
  orphanOlderThanMs = 24 * 60 * 60_000,
  temporaryOlderThanMs = 6 * 60 * 60_000,
  attemptOlderThanMs = 2 * 60 * 60_000,
  trashOlderThanMs = 24 * 60 * 60_000,
} = {}) {
  const ownerToken = await acquireMaintenanceJob(client, {
    jobKey,
    now,
    leaseMs: positiveNumber(leaseMs, DEFAULT_LEASE_MS),
  });
  if (!ownerToken) return { state: "busy" };

  try {
    const [files, recordings] = await Promise.all([
      client.fileAsset.findMany({
        select: {
          id: true,
          filePath: true,
          previewPdfPath: true,
          updatedAt: true,
        },
      }),
      client.trainingRecording.findMany({
        select: { id: true, filePath: true, updatedAt: true },
      }),
    ]);
    const references = [
      ...files.flatMap((file) => [file.filePath, file.previewPdfPath]),
      ...recordings.map((recording) => recording.filePath),
    ];
    const report = await scanUploadTree({
      workspaceRoot: path.resolve(
        /* turbopackIgnore: true */ workspaceRoot,
      ),
      references,
      nowMs: now.getTime(),
      deleteStale,
      orphanOlderThanMs,
      temporaryOlderThanMs,
      attemptOlderThanMs,
      trashOlderThanMs,
    });
    const reconciled = await reconcileMissingReferences(client, {
      files,
      recordings,
      report,
      now,
      graceMs: Math.max(0, Number(missingReferenceGraceMs) || 0),
    });
    await releaseMaintenanceJob(client, {
      jobKey,
      ownerToken,
      status: "COMPLETED",
    });
    return { state: "completed", report, reconciled };
  } catch (error) {
    await releaseMaintenanceJob(client, {
      jobKey,
      ownerToken,
      status: "FAILED",
      errorMessage: error instanceof Error ? error.message : String(error),
    }).catch(() => undefined);
    throw error;
  }
}
