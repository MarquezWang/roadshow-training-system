import { existsSync } from "fs";
import path from "path";
import { prisma } from "@/lib/prisma";
import { transcribeAudio } from "@/lib/transcription";
import {
  TranscribeBusinessError,
  TranscribeEmptyResultError,
} from "@/lib/transcribe-error";
import { devError, devLog, devWarn } from "@/lib/dev-log";
import {
  acquireTrainingTranscriptionJob,
  completeTrainingTranscriptionJob,
  failTrainingTranscriptionJob,
  renewTrainingTranscriptionLease,
  TRAINING_TRANSCRIPTION_JOB_TYPE,
  trainingTranscriptionJobKey,
} from "@/lib/training-transcription-job.mjs";

const TRANSCRIBE_RETRY_DELAYS_MS = [5_000, 30_000] as const;
const TEMPORARY_TRANSCRIBE_ERROR_MESSAGE =
  "转写服务暂时不可用，系统将自动重试。";
const RECOVERY_SCAN_INTERVAL_MS = 5_000;
const RECOVERY_SCAN_LIMIT = 25;
const TRANSCRIPTION_LEASE_HEARTBEAT_MS = 30_000;

export const transcriptSelect = {
  id: true,
  recordingId: true,
  sessionId: true,
  status: true,
  source: true,
  language: true,
  text: true,
  segmentsJson: true,
  errorMessage: true,
  startedAt: true,
  completedAt: true,
  createdAt: true,
  updatedAt: true,
  revision: true,
} as const;

type TranscriptionTarget = Awaited<ReturnType<typeof findTranscriptionTarget>>;
type TrainingTranscript = NonNullable<TranscriptionTarget["transcript"]>;
type AcquiredTranscriptionJob = {
  state: "acquired";
  ownerToken: string;
  job: {
    jobKey: string;
    attempt: number;
    maxAttempts: number;
  };
  transcript: TrainingTranscript;
};

export type TranscriptionRunResult =
  | {
      kind: "completed";
      transcript: TrainingTranscript;
    }
  | {
      kind: "pending";
      message: string;
      transcript: TrainingTranscript;
    }
  | {
      kind: "business-failed";
      message: string;
      transcript: TrainingTranscript;
    }
  | {
      kind: "system-failed";
      message: string;
      transcript: TrainingTranscript;
    };

export class TranscribeHttpError extends Error {
  status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = "TranscribeHttpError";
    this.status = status;
  }
}

export function getErrorSummary(error: unknown) {
  const message =
    error instanceof TranscribeBusinessError
      ? error.rawMessage || error.userMessage
      : error instanceof Error
        ? error.message
        : String(error);

  return message
    .replace(/sk-[A-Za-z0-9_-]+/g, "[redacted]")
    .replace(/Bearer\s+[A-Za-z0-9._-]+/g, "Bearer [redacted]")
    .slice(0, 500);
}

export function isRetryableTranscribeError(error: unknown) {
  const summary = getErrorSummary(error).toLowerCase();
  const isBusinessError = error instanceof TranscribeBusinessError;

  if (error instanceof TranscribeEmptyResultError) {
    return false;
  }

  const nonRetryableIndicators = [
    "api key",
    "unsupported",
    "not supported",
    "ffmpeg",
    "file does not exist",
    "audio file does not exist",
  ];

  if (nonRetryableIndicators.some((indicator) => summary.includes(indicator))) {
    return false;
  }

  const retryableIndicators = [
    "fetch failed",
    "network",
    "timeout",
    "timed out",
    "econnreset",
    "etimedout",
    "socket hang up",
    "temporarily unavailable",
    "service unavailable",
    "bad gateway",
    "gateway timeout",
    "internal server error",
    "http 500",
    "http 502",
    "http 503",
    "http 504",
    "5xx",
    "empty",
    "为空",
    "orderresult",
  ];

  if (isBusinessError) {
    return retryableIndicators.some((indicator) =>
      summary.includes(indicator),
    );
  }

  return retryableIndicators.some((indicator) => summary.includes(indicator));
}

async function findTranscriptionTarget(sessionId: string, recordingId: string) {
  const recording = await prisma.trainingRecording.findFirst({
    where: {
      id: recordingId,
      sessionId,
    },
    select: {
      id: true,
      sessionId: true,
      projectId: true,
      phase: true,
      filePath: true,
      mimeType: true,
      transcript: {
        select: transcriptSelect,
      },
    },
  });

  if (!recording) {
    throw new TranscribeHttpError("录音不存在。", 404);
  }

  if (recording.phase !== "PITCH" && recording.phase !== "QA") {
    throw new TranscribeHttpError("仅支持转写 PITCH 或 QA 阶段录音。", 400);
  }

  if (!recording.filePath) {
    throw new TranscribeHttpError("录音文件路径为空。", 400);
  }

  return {
    ...recording,
    absolutePath: path.resolve(
      /* turbopackIgnore: true */ process.cwd(),
      recording.filePath,
    ),
  };
}

async function readTranscript(recordingId: string) {
  return prisma.trainingTranscript.findUnique({
    where: { recordingId },
    select: transcriptSelect,
  });
}

function resultForUnacquiredJob(
  state: string,
  transcript: TrainingTranscript | null,
  errorMessage?: string | null,
): TranscriptionRunResult {
  if (!transcript) {
    throw new TranscribeHttpError("无法创建转写任务。", 500);
  }
  if (transcript.status === "COMPLETED" && transcript.text.trim()) {
    return { kind: "completed", transcript };
  }
  if (state === "exhausted" || transcript.status === "FAILED") {
    return {
      kind: "system-failed",
      message:
        errorMessage ?? transcript.errorMessage ?? "自动转写失败。",
      transcript,
    };
  }
  return {
    kind: "pending",
    message:
      state === "backoff"
        ? "转写任务正在等待自动重试。"
        : "转写任务已由其他处理器接管。",
    transcript,
  };
}

async function executeAcquiredTranscription(
  target: TranscriptionTarget,
  acquired: AcquiredTranscriptionJob,
): Promise<TranscriptionRunResult> {
  const { recordingId, revision } = acquired.transcript;
  const executionController = new AbortController();
  const heartbeat = setInterval(() => {
    void renewTrainingTranscriptionLease(prisma, {
      jobKey: acquired.job.jobKey,
      ownerToken: acquired.ownerToken,
    })
      .then((renewed: boolean) => {
        if (!renewed && !executionController.signal.aborted) {
          executionController.abort(new Error("transcription job lease lost"));
        }
      })
      .catch((error: unknown) => {
        devWarn("[transcribe:lease] heartbeat failed", {
          recordingId,
          errorSummary: getErrorSummary(error),
        });
      });
  }, TRANSCRIPTION_LEASE_HEARTBEAT_MS);
  heartbeat.unref?.();

  try {
    if (!existsSync(target.absolutePath)) {
      throw new TranscribeBusinessError(
        "录音文件不存在，请重新录制。",
        "audio file does not exist",
      );
    }

    devLog("[transcribe:run] persistent ASR attempt started", {
      sessionId: target.sessionId,
      recordingId,
      attempt: acquired.job.attempt,
    });
    const transcription = await transcribeAudio(
      target.absolutePath,
      target.mimeType,
      { signal: executionController.signal },
    );
    const completed = await completeTrainingTranscriptionJob(prisma, {
      jobKey: acquired.job.jobKey,
      ownerToken: acquired.ownerToken,
      recordingId,
      revision,
      text: transcription.text,
      segmentsJson:
        transcription.segments.length > 0
          ? JSON.stringify(transcription.segments)
          : null,
    });
    const transcript =
      completed.transcript ?? (await readTranscript(recordingId));

    if (transcript?.status === "COMPLETED") {
      return { kind: "completed", transcript };
    }
    if (!transcript) {
      throw new TranscribeHttpError("转写结果丢失。", 500);
    }
    return {
      kind: "pending",
      message: "当前转写结果已被更新版本取代。",
      transcript,
    };
  } catch (error) {
    const retryable = isRetryableTranscribeError(error);
    const isBusinessFailure = error instanceof TranscribeBusinessError;
    const errorSummary = getErrorSummary(error);
    const willRetry =
      retryable && acquired.job.attempt < acquired.job.maxAttempts;
    const errorMessage = isBusinessFailure
      ? error.userMessage
      : willRetry
        ? TEMPORARY_TRANSCRIBE_ERROR_MESSAGE
        : retryable
          ? "转写服务多次尝试仍失败，请稍后手工重试。"
          : errorSummary;
    const retryDelayMs =
      TRANSCRIBE_RETRY_DELAYS_MS[acquired.job.attempt - 1] ?? 30_000;

    devWarn("[transcribe:run] persistent ASR attempt failed", {
      sessionId: target.sessionId,
      recordingId,
      attempt: acquired.job.attempt,
      retryable,
      errorSummary,
    });
    const failed = await failTrainingTranscriptionJob(prisma, {
      jobKey: acquired.job.jobKey,
      ownerToken: acquired.ownerToken,
      recordingId,
      revision,
      retryable,
      retryDelayMs,
      errorMessage,
    });
    const transcript = failed.transcript ?? (await readTranscript(recordingId));

    if (transcript?.status === "COMPLETED") {
      return { kind: "completed", transcript };
    }
    if (!transcript) {
      throw error;
    }
    if (failed.state === "retry-scheduled" || failed.state === "owner-lost") {
      return {
        kind: "pending",
        message:
          failed.state === "retry-scheduled"
            ? TEMPORARY_TRANSCRIBE_ERROR_MESSAGE
            : "转写任务已被新的处理器接管。",
        transcript,
      };
    }
    if (isBusinessFailure) {
      return {
        kind: "business-failed",
        message: error.userMessage,
        transcript,
      };
    }
    return { kind: "system-failed", message: errorMessage, transcript };
  } finally {
    clearInterval(heartbeat);
    if (!executionController.signal.aborted) {
      executionController.abort(new Error("transcription attempt finished"));
    }
  }
}

async function acquireForTarget(
  target: TranscriptionTarget,
  forceRetry: boolean,
) {
  return acquireTrainingTranscriptionJob(prisma, {
    sessionId: target.sessionId,
    recordingId: target.id,
    forceRetry,
  });
}

export async function runTranscriptionWithLock(
  sessionId: string,
  recordingId: string,
  options: { forceRetry?: boolean } = {},
): Promise<TranscriptionRunResult> {
  const target = await findTranscriptionTarget(sessionId, recordingId);
  const acquired = await acquireForTarget(target, options.forceRetry ?? true);

  if (acquired.state !== "acquired") {
    return resultForUnacquiredJob(
      acquired.state,
      acquired.transcript,
      acquired.job?.errorMessage,
    );
  }
  return executeAcquiredTranscription(
    target,
    acquired as AcquiredTranscriptionJob,
  );
}

export async function startTranscriptionTask(
  sessionId: string,
  recordingId: string,
  options: { forceRetry?: boolean } = {},
) {
  const target = await findTranscriptionTarget(sessionId, recordingId);
  const acquired = await acquireForTarget(target, options.forceRetry ?? false);

  if (acquired.state !== "acquired") {
    if (!acquired.transcript) {
      throw new TranscribeHttpError("无法创建转写任务。", 500);
    }
    return {
      started: false,
      state: acquired.state,
      transcript: acquired.transcript,
    };
  }

  void executeAcquiredTranscription(
    target,
    acquired as AcquiredTranscriptionJob,
  ).catch((error) => {
    devError("[transcribe:start] background task crashed", {
      sessionId,
      recordingId,
      errorSummary: getErrorSummary(error),
    });
  });
  return {
    started: true,
    state: acquired.state,
    transcript: acquired.transcript as TrainingTranscript,
  };
}

export async function recoverTrainingTranscriptionsForSession(
  sessionId: string,
) {
  const recordings = await prisma.trainingRecording.findMany({
    where: {
      sessionId,
      phase: { in: ["PITCH", "QA"] },
      OR: [
        { transcript: { is: null } },
        {
          transcript: {
            is: { status: { in: ["PENDING", "PROCESSING"] } },
          },
        },
      ],
    },
    select: { id: true },
    take: RECOVERY_SCAN_LIMIT,
  });
  await Promise.allSettled(
    recordings.map((recording) =>
      startTranscriptionTask(sessionId, recording.id),
    ),
  );
  return recordings.length;
}

let recoveryPassRunning = false;

export async function recoverDueTrainingTranscriptions() {
  if (recoveryPassRunning) return 0;
  recoveryPassRunning = true;
  try {
    const now = new Date();
    const dueJobs = await prisma.asyncJob.findMany({
      where: {
        jobType: TRAINING_TRANSCRIPTION_JOB_TYPE,
        OR: [
          { status: "PENDING" },
          {
            status: "RETRY_WAIT",
            OR: [{ nextAttemptAt: null }, { nextAttemptAt: { lte: now } }],
          },
          {
            status: "RUNNING",
            OR: [{ leaseExpiresAt: null }, { leaseExpiresAt: { lte: now } }],
          },
        ],
      },
      orderBy: { updatedAt: "asc" },
      take: RECOVERY_SCAN_LIMIT,
      select: { resourceId: true },
    });
    const dueRecordingIds = dueJobs.map((job) => job.resourceId);
    const dueRecordings = await prisma.trainingRecording.findMany({
      where: {
        id: { in: dueRecordingIds },
        phase: { in: ["PITCH", "QA"] },
      },
      select: { id: true, sessionId: true },
    });
    const foundRecordingIds = new Set(
      dueRecordings.map((recording) => recording.id),
    );
    const missingResourceIds = dueRecordingIds.filter(
      (recordingId) => !foundRecordingIds.has(recordingId),
    );
    if (missingResourceIds.length > 0) {
      await prisma.asyncJob.updateMany({
        where: {
          jobType: TRAINING_TRANSCRIPTION_JOB_TYPE,
          resourceId: { in: missingResourceIds },
          status: { in: ["PENDING", "RETRY_WAIT", "RUNNING"] },
        },
        data: {
          status: "FAILED",
          leaseExpiresAt: null,
          nextAttemptAt: null,
          errorMessage: "录音记录已不存在。",
        },
      });
    }
    const recordings = dueRecordings;
    await Promise.allSettled(
      recordings.map((recording) =>
        startTranscriptionTask(recording.sessionId, recording.id),
      ),
    );
    return recordings.length;
  } catch (error) {
    devError("[transcribe:recovery] scan failed", {
      errorSummary: getErrorSummary(error),
    });
    return 0;
  } finally {
    recoveryPassRunning = false;
  }
}

const globalForRecovery = globalThis as typeof globalThis & {
  trainingTranscriptionRecoveryTimer?: ReturnType<typeof setInterval>;
};

export function startTrainingTranscriptionRecoveryWorker() {
  if (globalForRecovery.trainingTranscriptionRecoveryTimer) return;
  void recoverDueTrainingTranscriptions();
  const timer = setInterval(() => {
    void recoverDueTrainingTranscriptions();
  }, RECOVERY_SCAN_INTERVAL_MS);
  timer.unref?.();
  globalForRecovery.trainingTranscriptionRecoveryTimer = timer;
}

export function transcriptionJobKeyForRecording(recordingId: string) {
  return trainingTranscriptionJobKey(recordingId);
}
