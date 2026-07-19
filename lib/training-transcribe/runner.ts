import { devError } from "@/lib/dev-log";
import { usesExternalBackgroundWorker } from "@/lib/background-task-mode.mjs";
import { prisma } from "@/lib/prisma";
import {
  acquireTrainingTranscriptionJob,
  queueTrainingTranscriptionJob,
} from "@/lib/training-transcription-job.mjs";

import { getErrorSummary, TranscribeHttpError } from "./errors";
import { executeAcquiredTranscription } from "./execution";
import { findTranscriptionTarget } from "./repository";
import { resultForUnacquiredJob } from "./results";
import type {
  AcquiredTranscriptionJob,
  TranscriptionRunResult,
  TranscriptionTarget,
} from "./types";

function acquireForTarget(
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
    transcript: acquired.transcript,
  };
}

export async function queueTranscriptionTask(
  sessionId: string,
  recordingId: string,
  options: { forceRetry?: boolean } = {},
) {
  await findTranscriptionTarget(sessionId, recordingId);
  const queued = await queueTrainingTranscriptionJob(prisma, {
    sessionId,
    recordingId,
    forceRetry: options.forceRetry ?? false,
  });

  if (!queued.transcript) {
    throw new TranscribeHttpError("无法创建转写任务。", 500);
  }
  return {
    started: false,
    state: queued.state,
    transcript: queued.transcript,
  };
}

export function startOrQueueTranscriptionTask(
  sessionId: string,
  recordingId: string,
  options: { forceRetry?: boolean } = {},
) {
  return usesExternalBackgroundWorker()
    ? queueTranscriptionTask(sessionId, recordingId, options)
    : startTranscriptionTask(sessionId, recordingId, options);
}

export async function runOrQueueTranscription(
  sessionId: string,
  recordingId: string,
  options: { forceRetry?: boolean } = {},
): Promise<TranscriptionRunResult> {
  if (!usesExternalBackgroundWorker()) {
    return runTranscriptionWithLock(sessionId, recordingId, options);
  }

  const queued = await queueTranscriptionTask(sessionId, recordingId, options);
  return resultForUnacquiredJob(
    queued.state,
    queued.transcript,
    queued.transcript.errorMessage,
  );
}
