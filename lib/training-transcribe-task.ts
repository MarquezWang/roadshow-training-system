import { existsSync } from "fs";
import path from "path";
import { prisma } from "@/lib/prisma";
import { transcribeAudio } from "@/lib/transcription";
import {
  TranscribeBusinessError,
  TranscribeEmptyResultError,
} from "@/lib/transcribe-error";
import { devError, devLog, devWarn } from "@/lib/dev-log";

const MAX_TRANSCRIBE_ATTEMPTS = 3;
const TRANSCRIBE_RETRY_DELAYS_MS = [1_500, 3_000] as const;
const TEMPORARY_TRANSCRIBE_ERROR_MESSAGE =
  "转写服务暂时不可用，请稍后重试。";
const STALE_TRANSCRIPTION_TASK_TIMEOUT_MS = 90_000;

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
} as const;

type TranscriptionTarget = Awaited<ReturnType<typeof findTranscriptionTarget>>;
type TrainingTranscript = NonNullable<TranscriptionTarget["transcript"]>;

export type TranscriptionRunResult =
  | {
      kind: "completed";
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

const runningTranscriptionTasks = new Map<string, Promise<TranscriptionRunResult>>();

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isActiveTranscriptStatus(status: string) {
  return status === "PENDING" || status === "PROCESSING";
}

function isStaleActiveTranscript(transcript: TrainingTranscript) {
  return (
    isActiveTranscriptStatus(transcript.status) &&
    Date.now() - transcript.updatedAt.getTime() >
      STALE_TRANSCRIPTION_TASK_TIMEOUT_MS
  );
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
    "涓虹┖",
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

  const absolutePath = path.resolve(process.cwd(), recording.filePath);

  if (!existsSync(absolutePath)) {
    throw new TranscribeHttpError("录音文件不存在，请重新录制。", 400);
  }

  return {
    ...recording,
    absolutePath,
  };
}

async function markTranscriptProcessing(target: TranscriptionTarget) {
  const now = new Date();

  return prisma.trainingTranscript.upsert({
    where: {
      recordingId: target.id,
    },
    create: {
      recordingId: target.id,
      sessionId: target.sessionId,
      projectId: target.projectId,
      status: "PROCESSING",
      source: "ASR_PROVIDER",
      language: "zh-CN",
      text: "",
      startedAt: now,
    },
    update: {
      status: "PROCESSING",
      source: "ASR_PROVIDER",
      language: "zh-CN",
      text: "",
      errorMessage: null,
      startedAt: now,
      completedAt: null,
    },
    select: transcriptSelect,
  });
}

async function runTranscription(
  sessionId: string,
  recordingId: string,
): Promise<TranscriptionRunResult> {
  const target = await findTranscriptionTarget(sessionId, recordingId);

  if (target.transcript?.status === "COMPLETED" && target.transcript.text.trim()) {
    devLog("[transcribe:run] completed transcript exists", {
      sessionId,
      recordingId,
      transcriptId: target.transcript.id,
    });

    return {
      kind: "completed",
      transcript: target.transcript,
    };
  }

  await markTranscriptProcessing(target);

  try {
    let finalError: unknown = null;

    for (
      let attemptIndex = 1;
      attemptIndex <= MAX_TRANSCRIBE_ATTEMPTS;
      attemptIndex++
    ) {
      devLog("[transcribe:run] ASR attempt started", {
        sessionId,
        recordingId,
        attemptIndex,
        maxAttempts: MAX_TRANSCRIBE_ATTEMPTS,
      });

      try {
        const text = await transcribeAudio(target.absolutePath, target.mimeType);
        const completedAt = new Date();

        const updated = await prisma.trainingTranscript.update({
          where: {
            recordingId,
          },
          data: {
            status: "COMPLETED",
            text,
            completedAt,
            errorMessage: null,
          },
          select: transcriptSelect,
        });

        devLog("[transcribe:run] ASR attempt succeeded", {
          sessionId,
          recordingId,
          attemptIndex,
          maxAttempts: MAX_TRANSCRIBE_ATTEMPTS,
        });

        return {
          kind: "completed",
          transcript: updated,
        };
      } catch (error) {
        finalError = error;
        const retryable = isRetryableTranscribeError(error);
        const errorSummary = getErrorSummary(error);

        devWarn("[transcribe:run] ASR attempt failed", {
          sessionId,
          recordingId,
          attemptIndex,
          maxAttempts: MAX_TRANSCRIBE_ATTEMPTS,
          retryable,
          errorSummary,
        });

        if (!retryable || attemptIndex >= MAX_TRANSCRIBE_ATTEMPTS) {
          break;
        }

        await sleep(TRANSCRIBE_RETRY_DELAYS_MS[attemptIndex - 1] ?? 3_000);
      }
    }

    throw finalError ?? new Error(TEMPORARY_TRANSCRIBE_ERROR_MESSAGE);
  } catch (error) {
    const now = new Date();
    const errorSummary = getErrorSummary(error);

    devError("[transcribe:run] ASR final failure", {
      sessionId,
      recordingId,
      errorSummary,
    });

    if (error instanceof TranscribeBusinessError) {
      const updated = await prisma.trainingTranscript.update({
        where: {
          recordingId,
        },
        data: {
          status: "FAILED",
          errorMessage: error.userMessage,
          completedAt: now,
        },
        select: transcriptSelect,
      });

      return {
        kind: "business-failed",
        message: error.userMessage,
        transcript: updated,
      };
    }

    const errorMessage = isRetryableTranscribeError(error)
      ? TEMPORARY_TRANSCRIBE_ERROR_MESSAGE
      : errorSummary;

    const updated = await prisma.trainingTranscript.update({
      where: {
        recordingId,
      },
      data: {
        status: "FAILED",
        errorMessage,
        completedAt: now,
      },
      select: transcriptSelect,
    });

    return {
      kind: "system-failed",
      message: errorMessage,
      transcript: updated,
    };
  }
}

export function getRunningTranscriptionTask(recordingId: string) {
  return runningTranscriptionTasks.get(recordingId) ?? null;
}

export function runTranscriptionWithLock(sessionId: string, recordingId: string) {
  const runningTask = runningTranscriptionTasks.get(recordingId);

  if (runningTask) {
    return runningTask;
  }

  const task = runTranscription(sessionId, recordingId).finally(() => {
    if (runningTranscriptionTasks.get(recordingId) === task) {
      runningTranscriptionTasks.delete(recordingId);
    }
  });

  runningTranscriptionTasks.set(recordingId, task);
  return task;
}

export async function startTranscriptionTask(
  sessionId: string,
  recordingId: string,
) {
  const target = await findTranscriptionTarget(sessionId, recordingId);
  const runningTask = getRunningTranscriptionTask(recordingId);

  if (target.transcript?.status === "COMPLETED" && target.transcript.text.trim()) {
    return {
      started: false,
      transcript: target.transcript,
    };
  }

  if (
    target.transcript &&
    isActiveTranscriptStatus(target.transcript.status)
  ) {
    if (runningTask || !isStaleActiveTranscript(target.transcript)) {
      return {
        started: false,
        transcript: target.transcript,
      };
    }

    devWarn("[transcribe:start] stale transcript detected, restarting task", {
      sessionId,
      recordingId,
      transcriptId: target.transcript.id,
      status: target.transcript.status,
      staleAgeMs: Date.now() - target.transcript.updatedAt.getTime(),
      timeoutMs: STALE_TRANSCRIPTION_TASK_TIMEOUT_MS,
    });
  }

  const transcript = await markTranscriptProcessing(target);

  void runTranscriptionWithLock(sessionId, recordingId).catch((error) => {
    devError("[transcribe:start] background task crashed", {
      sessionId,
      recordingId,
      errorSummary: getErrorSummary(error),
    });
  });

  return {
    started: true,
    transcript,
  };
}
