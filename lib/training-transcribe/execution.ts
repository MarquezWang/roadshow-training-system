import { existsSync } from "fs";

import { devLog, devWarn } from "@/lib/dev-log";
import { prisma } from "@/lib/prisma";
import { TranscribeBusinessError } from "@/lib/transcribe-error";
import { transcribeAudio } from "@/lib/transcription";
import { TRANSCRIPT_SEGMENTS_SCHEMA_VERSION } from "@/lib/persisted-json-versions";
import {
  completeTrainingTranscriptionJob,
  failTrainingTranscriptionJob,
  renewTrainingTranscriptionLease,
} from "@/lib/training-transcription-job.mjs";

import {
  buildTranscriptionFailurePlan,
  getErrorSummary,
  TEMPORARY_TRANSCRIBE_ERROR_MESSAGE,
  TranscribeHttpError,
} from "./errors";
import { readTranscript } from "./repository";
import type {
  AcquiredTranscriptionJob,
  TranscriptionRunResult,
  TranscriptionTarget,
} from "./types";

const TRANSCRIPTION_LEASE_HEARTBEAT_MS = 30_000;

export async function executeAcquiredTranscription(
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
      segmentsSchemaVersion: TRANSCRIPT_SEGMENTS_SCHEMA_VERSION,
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
    const failure = buildTranscriptionFailurePlan(
      error,
      acquired.job.attempt,
      acquired.job.maxAttempts,
    );

    devWarn("[transcribe:run] persistent ASR attempt failed", {
      sessionId: target.sessionId,
      recordingId,
      attempt: acquired.job.attempt,
      retryable: failure.retryable,
      errorSummary: failure.errorSummary,
    });
    const failed = await failTrainingTranscriptionJob(prisma, {
      jobKey: acquired.job.jobKey,
      ownerToken: acquired.ownerToken,
      recordingId,
      revision,
      retryable: failure.retryable,
      retryDelayMs: failure.retryDelayMs,
      errorMessage: failure.errorMessage,
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
    if (failure.businessMessage !== null) {
      return {
        kind: "business-failed",
        message: failure.businessMessage,
        transcript,
      };
    }
    return {
      kind: "system-failed",
      message: failure.errorMessage,
      transcript,
    };
  } finally {
    clearInterval(heartbeat);
    if (!executionController.signal.aborted) {
      executionController.abort(new Error("transcription attempt finished"));
    }
  }
}
