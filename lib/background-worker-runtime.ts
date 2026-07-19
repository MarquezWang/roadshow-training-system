import { devError, devLog } from "@/lib/dev-log";
import { usesExternalBackgroundWorker } from "@/lib/background-task-mode.mjs";
import { prisma } from "@/lib/prisma";
import { recoverDueTrainingTranscriptions } from "@/lib/training-transcribe-task";
import { recoverDueTrainingAnalyses } from "@/lib/training-analysis-worker";
import {
  getUploadMaintenanceSchedule,
  isUploadMaintenanceEnabled,
  runConfiguredUploadMaintenancePass,
} from "@/lib/upload-maintenance-task";
import {
  cleanupStaleWorkerHeartbeats,
  createBackgroundWorkerIdentity,
  expireWorkerHeartbeat,
  getBackgroundWorkerTiming,
  recordWorkerHeartbeat,
  TRAINING_ANALYSIS_CAPABILITY,
  TRAINING_TRANSCRIPTION_CAPABILITY,
  UPLOAD_MAINTENANCE_CAPABILITY,
} from "@/lib/worker-heartbeat.mjs";

type WorkerClient = typeof prisma;

type BackgroundWorkerDependencies = {
  recoverTranscriptions: () => Promise<number>;
  recoverAnalyses: () => Promise<number>;
  runUploadMaintenance: () => Promise<unknown>;
};

const defaultDependencies: BackgroundWorkerDependencies = {
  recoverTranscriptions: recoverDueTrainingTranscriptions,
  recoverAnalyses: recoverDueTrainingAnalyses,
  runUploadMaintenance: runConfiguredUploadMaintenancePass,
};

function waitForAbort(signal: AbortSignal) {
  if (signal.aborted) return Promise.resolve();
  return new Promise<void>((resolve) => {
    signal.addEventListener("abort", () => resolve(), { once: true });
  });
}

export async function runBackgroundWorker({
  client = prisma,
  env = process.env,
  signal,
  dependencies = defaultDependencies,
}: {
  client?: WorkerClient;
  env?: NodeJS.ProcessEnv;
  signal: AbortSignal;
  dependencies?: BackgroundWorkerDependencies;
}) {
  if (!usesExternalBackgroundWorker(env)) {
    throw new Error(
      "The standalone worker requires BACKGROUND_TASK_MODE=external.",
    );
  }

  const timing = getBackgroundWorkerTiming(env);
  const maintenanceEnabled = isUploadMaintenanceEnabled(env);
  const maintenanceSchedule = getUploadMaintenanceSchedule(env);
  const identity = createBackgroundWorkerIdentity();
  const capabilities = [
    TRAINING_TRANSCRIPTION_CAPABILITY,
    TRAINING_ANALYSIS_CAPABILITY,
    ...(maintenanceEnabled ? [UPLOAD_MAINTENANCE_CAPABILITY] : []),
  ];
  const timers = new Set<ReturnType<typeof setTimeout>>();
  const inFlight = new Set<Promise<unknown>>();
  const inFlightByLabel = new Map<string, Promise<unknown>>();

  const track = (label: string, operation: () => Promise<unknown>) => {
    const existing = inFlightByLabel.get(label);
    if (existing) return existing;

    const task = operation().catch((error) => {
      devError(`[background-worker] ${label} failed`, {
        message:
          error instanceof Error ? error.message.slice(0, 300) : String(error),
      });
    });
    inFlight.add(task);
    inFlightByLabel.set(label, task);
    void task.finally(() => {
      inFlight.delete(task);
      if (inFlightByLabel.get(label) === task) {
        inFlightByLabel.delete(label);
      }
    });
    return task;
  };

  const heartbeat = () =>
    recordWorkerHeartbeat(client, {
      identity,
      capabilities,
      ttlMs: timing.heartbeatTtlMs,
    });

  await heartbeat();
  await cleanupStaleWorkerHeartbeats(client);
  devLog("[background-worker] started", {
    workerId: identity.id,
    capabilities,
    heartbeatIntervalMs: timing.heartbeatIntervalMs,
    pollIntervalMs: timing.pollIntervalMs,
  });

  const heartbeatTimer = setInterval(() => {
    void track("heartbeat", heartbeat);
  }, timing.heartbeatIntervalMs);
  timers.add(heartbeatTimer);

  void track("transcription recovery", dependencies.recoverTranscriptions);
  const recoveryTimer = setInterval(() => {
    void track("transcription recovery", dependencies.recoverTranscriptions);
  }, timing.pollIntervalMs);
  timers.add(recoveryTimer);

  void track("analysis recovery", dependencies.recoverAnalyses);
  const analysisRecoveryTimer = setInterval(() => {
    void track("analysis recovery", dependencies.recoverAnalyses);
  }, timing.pollIntervalMs);
  timers.add(analysisRecoveryTimer);

  if (maintenanceEnabled) {
    const startMaintenanceTimer = setTimeout(() => {
      timers.delete(startMaintenanceTimer);
      void track("upload maintenance", dependencies.runUploadMaintenance);
    }, maintenanceSchedule.initialDelayMs);
    timers.add(startMaintenanceTimer);
    const maintenanceTimer = setInterval(() => {
      void track("upload maintenance", dependencies.runUploadMaintenance);
    }, maintenanceSchedule.intervalMs);
    timers.add(maintenanceTimer);
  }

  await waitForAbort(signal);
  for (const timer of timers) {
    clearTimeout(timer);
  }
  await Promise.allSettled([...inFlight]);
  await expireWorkerHeartbeat(client, identity.id).catch(() => undefined);
  devLog("[background-worker] stopped", { workerId: identity.id });

  return { workerId: identity.id, capabilities };
}
