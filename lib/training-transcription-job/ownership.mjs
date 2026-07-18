import { randomUUID } from "node:crypto";

import { TRAINING_TRANSCRIPTION_JOB_TYPE } from "./constants.mjs";
import {
  isUniqueConstraintError,
  readCurrentState,
} from "./state.mjs";

export async function ensureTranscriptionJob(
  prisma,
  { jobKey, recordingId, maxAttempts },
) {
  try {
    await prisma.asyncJob.create({
      data: {
        jobKey,
        jobType: TRAINING_TRANSCRIPTION_JOB_TYPE,
        resourceId: recordingId,
        status: "PENDING",
        ownerToken: "",
        attempt: 0,
        maxAttempts,
      },
    });
  } catch (error) {
    if (!isUniqueConstraintError(error)) throw error;
  }
}

export async function resetForcedRetry(
  prisma,
  { job, recordingId, jobKey, maxAttempts },
) {
  await prisma.asyncJob.updateMany({
    where: {
      id: job.id,
      ownerToken: job.ownerToken,
      status: job.status,
    },
    data: {
      status: "PENDING",
      ownerToken: "",
      attempt: 0,
      maxAttempts,
      leaseExpiresAt: null,
      nextAttemptAt: null,
      errorMessage: null,
    },
  });
  return readCurrentState(prisma, recordingId, jobKey);
}

export async function resetCompletedJob(prisma, job, maxAttempts) {
  const reset = await prisma.asyncJob.updateMany({
    where: {
      id: job.id,
      ownerToken: job.ownerToken,
      status: "COMPLETED",
    },
    data: {
      status: "PENDING",
      ownerToken: "",
      attempt: 0,
      maxAttempts,
    },
  });
  return reset.count === 1
    ? prisma.asyncJob.findUniqueOrThrow({ where: { id: job.id } })
    : job;
}

export function getDeferredAcquisitionState(job, now) {
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
  return job.status === "FAILED" ? "exhausted" : null;
}

export function isAcquisitionEligible(job, now) {
  return (
    job.status === "PENDING" ||
    (job.status === "RETRY_WAIT" &&
      (!job.nextAttemptAt || job.nextAttemptAt <= now)) ||
    (job.status === "RUNNING" &&
      (!job.leaseExpiresAt || job.leaseExpiresAt <= now))
  );
}

export async function claimTranscriptionJob(
  prisma,
  { job, now, leaseMs, maxAttempts },
) {
  const ownerToken = randomUUID();
  const acquired = await prisma.asyncJob.updateMany({
    where: {
      id: job.id,
      ownerToken: job.ownerToken,
      status: job.status,
      attempt: job.attempt,
    },
    data: {
      status: "RUNNING",
      ownerToken,
      leaseExpiresAt: new Date(now.getTime() + leaseMs),
      nextAttemptAt: null,
      attempt: { increment: 1 },
      maxAttempts,
      errorMessage: null,
    },
  });
  return { acquired: acquired.count === 1, ownerToken };
}
