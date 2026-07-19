import { assertProductionAuthEnabled } from "@/lib/production-auth-guard.mjs";
import {
  assertProductionBackgroundTaskMode,
  runsBackgroundTasksInWebProcess,
} from "@/lib/background-task-mode.mjs";

export async function register() {
  assertProductionAuthEnabled();
  if (
    process.env.NEXT_RUNTIME === "nodejs" &&
    process.env.NEXT_PHASE !== "phase-production-build"
  ) {
    assertProductionBackgroundTaskMode();
    if (!runsBackgroundTasksInWebProcess()) return;
    if (
      process.env.NODE_ENV !== "production" &&
      process.env.STABILITY_TEST_DISABLE_EMBEDDED_WORKERS === "true"
    ) {
      return;
    }
    const { startTrainingTranscriptionRecoveryWorker } = await import(
      "@/lib/training-transcribe-task"
    );
    startTrainingTranscriptionRecoveryWorker();
    const { startUploadMaintenanceWorker } = await import(
      "@/lib/upload-maintenance-task"
    );
    startUploadMaintenanceWorker();
  }
}
