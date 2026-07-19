import { devError } from "@/lib/dev-log";
import { AIResourceLimitError } from "@/lib/ai-resource-guard";
import { prisma } from "@/lib/prisma";
import {
  acquireTrainingAnalysisJob,
  completeTrainingAnalysisJob,
  deferTrainingAnalysisJob,
  failTrainingAnalysisJob,
  startTrainingAnalysisLeaseRenewal,
  TRAINING_ANALYSIS_JOB_TYPE,
} from "@/lib/training-analysis-job.mjs";
import {
  executeTrainingAnalysisGeneration,
  getFriendlyTrainingAnalysisError,
  TrainingAnalysisTaskError,
} from "@/app/training/[sessionId]/analysis/training-analysis-executor";

const RECOVERY_SCAN_LIMIT = 5;
let recoveryPassRunning = false;

export async function recoverDueTrainingAnalyses() {
  if (recoveryPassRunning) return 0;
  recoveryPassRunning = true;
  try {
    const now = new Date();
    const dueJobs = await prisma.asyncJob.findMany({
      where: {
        jobType: TRAINING_ANALYSIS_JOB_TYPE,
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

    let acquiredCount = 0;
    for (const job of dueJobs) {
      const acquired = await acquireTrainingAnalysisJob(prisma, {
        sessionId: job.resourceId,
      });
      if (acquired.state !== "acquired") continue;
      const ownerToken = acquired.ownerToken;
      const payload = acquired.payload;
      if (!ownerToken || !payload) continue;
      acquiredCount += 1;
      const leaseRenewal = startTrainingAnalysisLeaseRenewal(prisma, {
        sessionId: job.resourceId,
        ownerToken,
        onError(error: unknown) {
          devError("[training-analysis-worker] lease renewal failed", {
            sessionId: job.resourceId,
            message:
              error instanceof Error ? error.message : String(error),
          });
        },
        onOwnershipLost() {
          devError("[training-analysis-worker] lease ownership lost", {
            sessionId: job.resourceId,
          });
        },
      });

      try {
        await executeTrainingAnalysisGeneration({
          sessionId: job.resourceId,
          ownerToken,
          forceRegeneration: payload.forceRegeneration,
        });
        const completed = await completeTrainingAnalysisJob(prisma, {
          sessionId: job.resourceId,
          ownerToken,
        });
        if (!completed) {
          devError("[training-analysis-worker] completion owner lost", {
            sessionId: job.resourceId,
          });
        }
      } catch (error) {
        const message = getFriendlyTrainingAnalysisError(error);
        const resourceLimitError =
          error instanceof AIResourceLimitError ? error : null;
        const retryable =
          error instanceof TrainingAnalysisTaskError
            ? error.retryable
            : true;
        const transition = resourceLimitError
          ? await deferTrainingAnalysisJob(prisma, {
              sessionId: job.resourceId,
              ownerToken,
              errorMessage: message,
              retryDelayMs:
                Math.max(1, resourceLimitError.retryAfterSec) * 1_000,
            })
          : await failTrainingAnalysisJob(prisma, {
              sessionId: job.resourceId,
              ownerToken,
              errorMessage: message,
              retryable,
            });
        devError(
          resourceLimitError
            ? "[training-analysis-worker] generation deferred"
            : "[training-analysis-worker] generation failed",
          {
            sessionId: job.resourceId,
            retryable,
            retryAfterSec: resourceLimitError?.retryAfterSec ?? null,
            resourceLimitCode: resourceLimitError?.code ?? null,
            transitionState: transition.state,
            message: message.slice(0, 300),
          },
        );
      } finally {
        await leaseRenewal.stop();
      }
    }
    return acquiredCount;
  } catch (error) {
    devError("[training-analysis-worker] recovery scan failed", {
      message: getFriendlyTrainingAnalysisError(error).slice(0, 300),
    });
    return 0;
  } finally {
    recoveryPassRunning = false;
  }
}
