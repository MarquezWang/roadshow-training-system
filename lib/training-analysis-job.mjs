import { randomUUID } from "node:crypto";

export const TRAINING_ANALYSIS_JOB_TYPE = "TRAINING_ANALYSIS";
export const TRAINING_ANALYSIS_JOB_PAYLOAD_SCHEMA_VERSION =
  "training-analysis-job:v1";
export const DEFAULT_TRAINING_ANALYSIS_MAX_ATTEMPTS = 3;
export const DEFAULT_TRAINING_ANALYSIS_LEASE_MS = 15 * 60_000;
export const DEFAULT_TRAINING_ANALYSIS_LEASE_RENEWAL_INTERVAL_MS = 60_000;

const DEFAULT_RETRY_DELAYS_MS = [30_000, 2 * 60_000];

export function trainingAnalysisJobKey(sessionId) {
  return `training-analysis:${sessionId}`;
}

function payloadJson(forceRegeneration) {
  return JSON.stringify({ forceRegeneration: Boolean(forceRegeneration) });
}

export function parseTrainingAnalysisJobPayload(job) {
  if (
    !job?.payloadJson ||
    job.payloadSchemaVersion !==
      TRAINING_ANALYSIS_JOB_PAYLOAD_SCHEMA_VERSION
  ) {
    return { forceRegeneration: false };
  }
  try {
    const payload = JSON.parse(job.payloadJson);
    return {
      forceRegeneration: payload?.forceRegeneration === true,
    };
  } catch {
    return { forceRegeneration: false };
  }
}

function stateForDeferredJob(job, now) {
  if (
    job.status === "RUNNING" &&
    job.leaseExpiresAt &&
    job.leaseExpiresAt > now
  ) {
    return "active";
  }
  if (
    job.status === "RETRY_WAIT" &&
    job.nextAttemptAt &&
    job.nextAttemptAt > now
  ) {
    return "backoff";
  }
  return null;
}

export async function queueTrainingAnalysisJob(
  prisma,
  {
    sessionId,
    forceRegeneration = false,
    maxAttempts = DEFAULT_TRAINING_ANALYSIS_MAX_ATTEMPTS,
    now = new Date(),
  },
) {
  const jobKey = trainingAnalysisJobKey(sessionId);
  let job = await prisma.asyncJob.upsert({
    where: { jobKey },
    create: {
      jobKey,
      jobType: TRAINING_ANALYSIS_JOB_TYPE,
      resourceId: sessionId,
      status: "PENDING",
      ownerToken: "",
      attempt: 0,
      maxAttempts,
      payloadJson: payloadJson(forceRegeneration),
      payloadSchemaVersion: TRAINING_ANALYSIS_JOB_PAYLOAD_SCHEMA_VERSION,
    },
    update: {},
  });

  if (
    job.jobType !== TRAINING_ANALYSIS_JOB_TYPE ||
    job.resourceId !== sessionId
  ) {
    throw new Error("training_analysis_job_key_conflict");
  }

  const deferredState = stateForDeferredJob(job, now);
  if (deferredState === "active") {
    return { state: deferredState, job };
  }

  const existingPayload = parseTrainingAnalysisJobPayload(job);
  const requestedForce =
    forceRegeneration || existingPayload.forceRegeneration;

  if (job.status === "PENDING") {
    if (
      requestedForce !== existingPayload.forceRegeneration ||
      job.maxAttempts !== maxAttempts
    ) {
      job = await prisma.asyncJob.update({
        where: { id: job.id },
        data: {
          maxAttempts,
          payloadJson: payloadJson(requestedForce),
          payloadSchemaVersion:
            TRAINING_ANALYSIS_JOB_PAYLOAD_SCHEMA_VERSION,
        },
      });
    }
    return { state: "queued", job };
  }

  if (job.status === "RETRY_WAIT" && !forceRegeneration) {
    return { state: deferredState ?? "queued", job };
  }

  job = await prisma.asyncJob.update({
    where: { id: job.id },
    data: {
      status: "PENDING",
      ownerToken: "",
      leaseExpiresAt: null,
      attempt: 0,
      maxAttempts,
      nextAttemptAt: null,
      errorMessage: null,
      payloadJson: payloadJson(requestedForce),
      payloadSchemaVersion: TRAINING_ANALYSIS_JOB_PAYLOAD_SCHEMA_VERSION,
    },
  });
  return { state: "queued", job };
}

export async function acquireTrainingAnalysisJob(
  prisma,
  {
    sessionId,
    now = new Date(),
    leaseMs = DEFAULT_TRAINING_ANALYSIS_LEASE_MS,
  },
) {
  const jobKey = trainingAnalysisJobKey(sessionId);
  const job = await prisma.asyncJob.findUnique({ where: { jobKey } });
  if (
    !job ||
    job.jobType !== TRAINING_ANALYSIS_JOB_TYPE ||
    job.resourceId !== sessionId
  ) {
    return { state: "missing", job: null };
  }

  const deferredState = stateForDeferredJob(job, now);
  if (deferredState) return { state: deferredState, job };
  if (job.status === "COMPLETED") return { state: "completed", job };
  if (job.status === "FAILED") return { state: "exhausted", job };

  if (job.attempt >= job.maxAttempts) {
    await prisma.asyncJob.updateMany({
      where: {
        id: job.id,
        status: job.status,
        ownerToken: job.ownerToken,
        attempt: job.attempt,
      },
      data: {
        status: "FAILED",
        ownerToken: "",
        leaseExpiresAt: null,
        nextAttemptAt: null,
        errorMessage: "训练报告生成重试次数已用尽。",
      },
    });
    return {
      state: "exhausted",
      job: await prisma.asyncJob.findUnique({ where: { id: job.id } }),
    };
  }

  const ownerToken = randomUUID();
  const acquired = await prisma.asyncJob.updateMany({
    where: {
      id: job.id,
      status: job.status,
      ownerToken: job.ownerToken,
      attempt: job.attempt,
    },
    data: {
      status: "RUNNING",
      ownerToken,
      leaseExpiresAt: new Date(now.getTime() + leaseMs),
      nextAttemptAt: null,
      attempt: { increment: 1 },
      errorMessage: null,
    },
  });
  if (acquired.count !== 1) {
    return {
      state: "contended",
      job: await prisma.asyncJob.findUnique({ where: { id: job.id } }),
    };
  }

  const acquiredJob = await prisma.asyncJob.findUniqueOrThrow({
    where: { id: job.id },
  });
  return {
    state: "acquired",
    ownerToken,
    job: acquiredJob,
    payload: parseTrainingAnalysisJobPayload(acquiredJob),
  };
}

export async function renewTrainingAnalysisJobLease(
  prisma,
  {
    sessionId,
    ownerToken,
    now = new Date(),
    leaseMs = DEFAULT_TRAINING_ANALYSIS_LEASE_MS,
  },
) {
  const renewed = await prisma.asyncJob.updateMany({
    where: {
      jobKey: trainingAnalysisJobKey(sessionId),
      jobType: TRAINING_ANALYSIS_JOB_TYPE,
      resourceId: sessionId,
      status: "RUNNING",
      ownerToken,
      leaseExpiresAt: { gt: now },
    },
    data: {
      leaseExpiresAt: new Date(now.getTime() + leaseMs),
    },
  });

  return renewed.count === 1;
}

export function startTrainingAnalysisLeaseRenewal(
  prisma,
  {
    sessionId,
    ownerToken,
    intervalMs = DEFAULT_TRAINING_ANALYSIS_LEASE_RENEWAL_INTERVAL_MS,
    leaseMs = DEFAULT_TRAINING_ANALYSIS_LEASE_MS,
    onError = (error) => error,
    onOwnershipLost = () => undefined,
  },
) {
  let stopped = false;
  let timer;
  let renewalInFlight = null;

  const stopTimer = () => {
    stopped = true;
    if (timer) clearInterval(timer);
  };
  const renew = () => {
    if (stopped || renewalInFlight) return;

    renewalInFlight = renewTrainingAnalysisJobLease(prisma, {
      sessionId,
      ownerToken,
      leaseMs,
    })
      .then((renewed) => {
        if (!renewed) {
          stopTimer();
          onOwnershipLost();
        }
      })
      .catch((error) => {
        onError(error);
      })
      .finally(() => {
        renewalInFlight = null;
      });
  };

  timer = setInterval(renew, intervalMs);
  timer.unref?.();

  return {
    async stop() {
      stopTimer();
      await renewalInFlight?.catch(() => undefined);
    },
  };
}

export async function completeTrainingAnalysisJob(
  prisma,
  { sessionId, ownerToken, now = new Date() },
) {
  const result = await prisma.asyncJob.updateMany({
    where: {
      jobKey: trainingAnalysisJobKey(sessionId),
      jobType: TRAINING_ANALYSIS_JOB_TYPE,
      resourceId: sessionId,
      status: "RUNNING",
      ownerToken,
      leaseExpiresAt: { gt: now },
    },
    data: {
      status: "COMPLETED",
      ownerToken: "",
      leaseExpiresAt: null,
      nextAttemptAt: null,
      errorMessage: null,
      payloadJson: null,
    },
  });
  if (result.count === 1) return true;

  const job = await prisma.asyncJob.findUnique({
    where: { jobKey: trainingAnalysisJobKey(sessionId) },
    select: {
      jobType: true,
      resourceId: true,
      status: true,
      payloadJson: true,
    },
  });
  return Boolean(
    job?.jobType === TRAINING_ANALYSIS_JOB_TYPE &&
      job.resourceId === sessionId &&
      job.status === "COMPLETED" &&
      job.payloadJson === null,
  );
}

export async function failTrainingAnalysisJob(
  prisma,
  {
    sessionId,
    ownerToken,
    errorMessage,
    retryable = true,
    retryDelayMs = undefined,
    preserveAttempt = false,
    now = new Date(),
  },
) {
  const jobKey = trainingAnalysisJobKey(sessionId);
  const job = await prisma.asyncJob.findUnique({ where: { jobKey } });
  if (
    !job ||
    job.jobType !== TRAINING_ANALYSIS_JOB_TYPE ||
    job.resourceId !== sessionId ||
    job.status !== "RUNNING" ||
    job.ownerToken !== ownerToken ||
    !job.leaseExpiresAt ||
    job.leaseExpiresAt <= now
  ) {
    return { state: "owner-lost", job };
  }

  const canRetry =
    retryable && (preserveAttempt || job.attempt < job.maxAttempts);
  const delayMs =
    retryDelayMs ??
    DEFAULT_RETRY_DELAYS_MS[
      Math.min(Math.max(job.attempt - 1, 0), DEFAULT_RETRY_DELAYS_MS.length - 1)
    ];
  const updated = await prisma.asyncJob.updateMany({
    where: {
      id: job.id,
      status: "RUNNING",
      ownerToken,
      attempt: job.attempt,
      leaseExpiresAt: { gt: now },
    },
    data: canRetry
      ? {
          status: "RETRY_WAIT",
          ownerToken: "",
          leaseExpiresAt: null,
          nextAttemptAt: new Date(now.getTime() + delayMs),
          errorMessage: String(errorMessage).slice(0, 500),
          ...(preserveAttempt
            ? { attempt: Math.max(job.attempt - 1, 0) }
            : {}),
        }
      : {
          status: "FAILED",
          ownerToken: "",
          leaseExpiresAt: null,
          nextAttemptAt: null,
          errorMessage: String(errorMessage).slice(0, 500),
        },
  });
  if (updated.count !== 1) {
    return {
      state: "owner-lost",
      job: await prisma.asyncJob.findUnique({ where: { id: job.id } }),
    };
  }
  return {
    state: canRetry
      ? preserveAttempt
        ? "deferred"
        : "retry-scheduled"
      : "failed",
    job: await prisma.asyncJob.findUnique({ where: { id: job.id } }),
  };
}

export async function deferTrainingAnalysisJob(
  prisma,
  {
    sessionId,
    ownerToken,
    errorMessage,
    retryDelayMs,
    now = new Date(),
  },
) {
  return failTrainingAnalysisJob(prisma, {
    sessionId,
    ownerToken,
    errorMessage,
    retryable: true,
    retryDelayMs,
    preserveAttempt: true,
    now,
  });
}
