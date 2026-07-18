import { devError } from "@/lib/dev-log";

import { getErrorSummary } from "./errors";
import {
  findDueTrainingTranscriptionRecordings,
  findSessionRecoveryRecordings,
} from "./repository";
import { startTranscriptionTask } from "./runner";

const RECOVERY_SCAN_INTERVAL_MS = 5_000;

export async function recoverTrainingTranscriptionsForSession(
  sessionId: string,
) {
  const recordings = await findSessionRecoveryRecordings(sessionId);
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
    const recordings = await findDueTrainingTranscriptionRecordings(new Date());
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
