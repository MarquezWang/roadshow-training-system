import { assertProductionAuthEnabled } from "@/lib/production-auth-guard.mjs";

export async function register() {
  assertProductionAuthEnabled();
  if (
    process.env.NEXT_RUNTIME === "nodejs" &&
    process.env.NEXT_PHASE !== "phase-production-build"
  ) {
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
