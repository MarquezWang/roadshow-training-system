import { devError, devLog } from "@/lib/dev-log";
import { prisma } from "@/lib/prisma";
import { cleanupExpiredProjectMaterials } from "@/lib/project-material-staging";
import { runUploadMaintenancePass } from "@/lib/upload-maintenance-job.mjs";

const DEFAULT_INITIAL_DELAY_MS = 30_000;

function positiveNumber(value: string | undefined, fallback: number) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function hoursToMs(value: string | undefined, fallbackHours: number) {
  return positiveNumber(value, fallbackHours) * 60 * 60_000;
}

export function getConfiguredUploadMaintenanceOptions() {
  return {
    orphanOlderThanMs: hoursToMs(
      process.env.UPLOAD_ORPHAN_RETENTION_HOURS,
      24,
    ),
    temporaryOlderThanMs: hoursToMs(
      process.env.UPLOAD_TEMP_RETENTION_HOURS,
      6,
    ),
    attemptOlderThanMs: hoursToMs(
      process.env.UPLOAD_ATTEMPT_RETENTION_HOURS,
      2,
    ),
    trashOlderThanMs: hoursToMs(
      process.env.UPLOAD_TRASH_RETENTION_HOURS,
      24,
    ),
    missingReferenceGraceMs:
      positiveNumber(
        process.env.UPLOAD_MISSING_REFERENCE_GRACE_MINUTES,
        10,
      ) * 60_000,
  };
}

export function isUploadMaintenanceEnabled(env = process.env) {
  return env.UPLOAD_MAINTENANCE_ENABLED?.trim().toLowerCase() === "true";
}

export function getUploadMaintenanceSchedule(env = process.env) {
  return {
    initialDelayMs: Math.max(
      5_000,
      positiveNumber(
        env.UPLOAD_MAINTENANCE_INITIAL_DELAY_MS,
        DEFAULT_INITIAL_DELAY_MS,
      ),
    ),
    intervalMs: Math.max(
      60_000,
      hoursToMs(env.UPLOAD_MAINTENANCE_INTERVAL_HOURS, 6),
    ),
  };
}

let maintenancePassRunning = false;

export async function runConfiguredUploadMaintenancePass() {
  if (maintenancePassRunning) return { state: "busy" as const };
  maintenancePassRunning = true;
  try {
    const result = await runUploadMaintenancePass(
      prisma,
      getConfiguredUploadMaintenanceOptions(),
    );
    await cleanupExpiredProjectMaterials(100);
    if (result.state === "completed" && result.report && result.reconciled) {
      devLog("[upload-maintenance] pass completed", {
        deleted: result.report.deleted.length,
        missingReferences: result.report.missingReferences.length,
        reconciled: result.reconciled,
      });
    }
    return result;
  } catch (error) {
    devError("[upload-maintenance] pass failed", {
      message: error instanceof Error ? error.message.slice(0, 300) : String(error),
    });
    return { state: "failed" as const };
  } finally {
    maintenancePassRunning = false;
  }
}

const globalForUploadMaintenance = globalThis as typeof globalThis & {
  uploadMaintenanceInitialTimer?: ReturnType<typeof setTimeout>;
  uploadMaintenanceIntervalTimer?: ReturnType<typeof setInterval>;
};

export function startUploadMaintenanceWorker() {
  if (!isUploadMaintenanceEnabled()) return false;
  if (
    globalForUploadMaintenance.uploadMaintenanceInitialTimer ||
    globalForUploadMaintenance.uploadMaintenanceIntervalTimer
  ) {
    return true;
  }

  const { initialDelayMs, intervalMs } = getUploadMaintenanceSchedule();
  const initialTimer = setTimeout(() => {
    globalForUploadMaintenance.uploadMaintenanceInitialTimer = undefined;
    void runConfiguredUploadMaintenancePass();
  }, initialDelayMs);
  initialTimer.unref?.();
  const intervalTimer = setInterval(() => {
    void runConfiguredUploadMaintenancePass();
  }, intervalMs);
  intervalTimer.unref?.();
  globalForUploadMaintenance.uploadMaintenanceInitialTimer = initialTimer;
  globalForUploadMaintenance.uploadMaintenanceIntervalTimer = intervalTimer;
  return true;
}
