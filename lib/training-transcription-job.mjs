import { randomUUID } from "node:crypto";

export const TRAINING_TRANSCRIPTION_JOB_TYPE = "TRAINING_TRANSCRIPTION";
export const DEFAULT_TRANSCRIPTION_MAX_ATTEMPTS = 3;
export const DEFAULT_TRANSCRIPTION_LEASE_MS = 5 * 60_000;

const transcriptSelect = {
  id: true,
  recordingId: true,
  sessionId: true,
  status: true,
  source: true,
  language: true,
  text: true,
  segmentsJson: true,
  errorMessage: true,
  startedAt: true,
  completedAt: true,
  createdAt: true,
  updatedAt: true,
  revision: true,
};

export function trainingTranscriptionJobKey(recordingId) {
  return `training-transcription:${recordingId}`;
}

function isCompletedTranscript(transcript) {
  return transcript?.status === "COMPLETED" && Boolean(transcript.text.trim());
}

function isUniqueConstraintError(error) {
  return Boolean(error && typeof error === "object" && error.code === "P2002");
}

async function readCurrentState(prisma, recordingId, jobKey) {
  const [job, transcript] = await Promise.all([
    prisma.asyncJob.findUnique({ where: { jobKey } }),
    prisma.trainingTranscript.findUnique({
      where: { recordingId },
      select: transcriptSelect,
    }),
  ]);
  return { job, transcript };
}

async function settleCompletedTranscriptJob(prisma, jobKey) {
  await prisma.asyncJob.updateMany({
    where: {
      jobKey,
      status: { not: "COMPLETED" },
    },
    data: {
      status: "COMPLETED",
      leaseExpiresAt: null,
      nextAttemptAt: null,
      errorMessage: null,
    },
  });
}

async function markAttemptLimitReached(prisma, params) {
  const message = "自动转写重试次数已用尽，请手工重试或补充转写文本。";
  const updatedJob = await prisma.asyncJob.updateMany({
    where: {
      id: params.job.id,
      ownerToken: params.job.ownerToken,
      status: params.job.status,
      attempt: params.job.attempt,
    },
    data: {
      status: "FAILED",
      leaseExpiresAt: null,
      nextAttemptAt: null,
      errorMessage: message,
    },
  });

  if (updatedJob.count === 1 && params.transcript) {
    await prisma.trainingTranscript.updateMany({
      where: {
        id: params.transcript.id,
        revision: params.transcript.revision,
        status: { in: ["PENDING", "PROCESSING"] },
        source: "ASR_PROVIDER",
      },
      data: {
        status: "FAILED",
        errorMessage: message,
        completedAt: params.now,
      },
    });
  }
}

export async function acquireTrainingTranscriptionJob(prisma, params) {
  const now = params.now ?? new Date();
  const leaseMs = params.leaseMs ?? DEFAULT_TRANSCRIPTION_LEASE_MS;
  const maxAttempts =
    params.maxAttempts ?? DEFAULT_TRANSCRIPTION_MAX_ATTEMPTS;
  const jobKey = trainingTranscriptionJobKey(params.recordingId);
  const recording = await prisma.trainingRecording.findFirst({
    where: {
      id: params.recordingId,
      sessionId: params.sessionId,
    },
    select: {
      id: true,
      sessionId: true,
      projectId: true,
      transcript: { select: transcriptSelect },
    },
  });

  if (!recording) {
    return { state: "missing", job: null, transcript: null };
  }

  if (isCompletedTranscript(recording.transcript)) {
    await settleCompletedTranscriptJob(prisma, jobKey);
    return {
      state: "completed",
      job: await prisma.asyncJob.findUnique({ where: { jobKey } }),
      transcript: recording.transcript,
    };
  }

  try {
    await prisma.asyncJob.create({
      data: {
        jobKey,
        jobType: TRAINING_TRANSCRIPTION_JOB_TYPE,
        resourceId: recording.id,
        status: "PENDING",
        ownerToken: "",
        attempt: 0,
        maxAttempts,
      },
    });
  } catch (error) {
    if (!isUniqueConstraintError(error)) throw error;
  }

  let { job, transcript } = await readCurrentState(
    prisma,
    recording.id,
    jobKey,
  );

  if (!job) {
    throw new Error("transcription_job_missing_after_create");
  }

  if (
    params.forceRetry &&
    (job.status === "FAILED" || job.status === "COMPLETED")
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
    ({ job, transcript } = await readCurrentState(
      prisma,
      recording.id,
      jobKey,
    ));
  }

  if (!job) {
    throw new Error("transcription_job_missing_before_acquire");
  }

  if (isCompletedTranscript(transcript)) {
    await settleCompletedTranscriptJob(prisma, jobKey);
    return { state: "completed", job, transcript };
  }

  if (
    job.status === "RUNNING" &&
    job.leaseExpiresAt &&
    job.leaseExpiresAt > now
  ) {
    return { state: "active", job, transcript };
  }

  if (
    job.status === "RETRY_WAIT" &&
    job.nextAttemptAt &&
    job.nextAttemptAt > now
  ) {
    return { state: "backoff", job, transcript };
  }

  if (job.status === "FAILED") {
    return { state: "exhausted", job, transcript };
  }

  if (job.status === "COMPLETED") {
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
    if (reset.count === 1) {
      job = await prisma.asyncJob.findUniqueOrThrow({ where: { id: job.id } });
    }
  }

  if (job.attempt >= maxAttempts) {
    await markAttemptLimitReached(prisma, { job, transcript, now });
    const current = await readCurrentState(prisma, recording.id, jobKey);
    return { state: "exhausted", ...current };
  }

  const eligible =
    job.status === "PENDING" ||
    (job.status === "RETRY_WAIT" &&
      (!job.nextAttemptAt || job.nextAttemptAt <= now)) ||
    (job.status === "RUNNING" &&
      (!job.leaseExpiresAt || job.leaseExpiresAt <= now));

  if (!eligible) {
    return { state: "inactive", job, transcript };
  }

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

  if (acquired.count !== 1) {
    const current = await readCurrentState(prisma, recording.id, jobKey);
    return { state: "active", ...current };
  }

  let processingTranscript = transcript;
  if (transcript) {
    const prepared = await prisma.trainingTranscript.updateMany({
      where: {
        id: transcript.id,
        revision: transcript.revision,
        NOT: {
          status: "COMPLETED",
          source: "MANUAL",
        },
      },
      data: {
        status: "PROCESSING",
        source: "ASR_PROVIDER",
        language: "zh-CN",
        text: "",
        segmentsJson: null,
        errorMessage: null,
        startedAt: now,
        completedAt: null,
        revision: { increment: 1 },
      },
    });
    if (prepared.count === 1) {
      processingTranscript = await prisma.trainingTranscript.findUniqueOrThrow({
        where: { id: transcript.id },
        select: transcriptSelect,
      });
    }
  } else {
    try {
      processingTranscript = await prisma.trainingTranscript.create({
        data: {
          recordingId: recording.id,
          sessionId: recording.sessionId,
          projectId: recording.projectId,
          status: "PROCESSING",
          source: "ASR_PROVIDER",
          language: "zh-CN",
          text: "",
          startedAt: now,
          revision: 1,
        },
        select: transcriptSelect,
      });
    } catch (error) {
      if (!isUniqueConstraintError(error)) throw error;
    }
  }

  if (!processingTranscript || processingTranscript.status !== "PROCESSING") {
    const current = await readCurrentState(prisma, recording.id, jobKey);
    if (isCompletedTranscript(current.transcript)) {
      await settleCompletedTranscriptJob(prisma, jobKey);
      return { state: "completed", ...current };
    }
    return { state: "superseded", ...current };
  }

  const acquiredJob = await prisma.asyncJob.findUniqueOrThrow({
    where: { jobKey },
  });
  return {
    state: "acquired",
    ownerToken,
    job: acquiredJob,
    transcript: processingTranscript,
  };
}

export async function renewTrainingTranscriptionLease(prisma, params) {
  const now = params.now ?? new Date();
  const result = await prisma.asyncJob.updateMany({
    where: {
      jobKey: params.jobKey,
      ownerToken: params.ownerToken,
      status: "RUNNING",
    },
    data: {
      leaseExpiresAt: new Date(
        now.getTime() +
          (params.leaseMs ?? DEFAULT_TRANSCRIPTION_LEASE_MS),
      ),
    },
  });
  return result.count === 1;
}

export async function completeTrainingTranscriptionJob(prisma, params) {
  const now = params.now ?? new Date();
  return prisma.$transaction(async (transaction) => {
    const released = await transaction.asyncJob.updateMany({
      where: {
        jobKey: params.jobKey,
        ownerToken: params.ownerToken,
        status: "RUNNING",
        leaseExpiresAt: { gt: now },
      },
      data: {
        status: "COMPLETED",
        leaseExpiresAt: null,
        nextAttemptAt: null,
        errorMessage: null,
      },
    });
    if (released.count !== 1) {
      return { state: "owner-lost", transcript: null };
    }

    const written = await transaction.trainingTranscript.updateMany({
      where: {
        recordingId: params.recordingId,
        revision: params.revision,
        status: "PROCESSING",
        source: "ASR_PROVIDER",
      },
      data: {
        status: "COMPLETED",
        text: params.text,
        segmentsJson: params.segmentsJson ?? null,
        errorMessage: null,
        completedAt: now,
      },
    });
    const transcript = await transaction.trainingTranscript.findUnique({
      where: { recordingId: params.recordingId },
      select: transcriptSelect,
    });
    return {
      state: written.count === 1 ? "completed" : "superseded",
      transcript,
    };
  });
}

export async function failTrainingTranscriptionJob(prisma, params) {
  const now = params.now ?? new Date();
  const retryDelayMs = Math.max(0, params.retryDelayMs ?? 0);
  return prisma.$transaction(async (transaction) => {
    const job = await transaction.asyncJob.findUnique({
      where: { jobKey: params.jobKey },
    });
    if (
      !job ||
      job.ownerToken !== params.ownerToken ||
      job.status !== "RUNNING" ||
      !job.leaseExpiresAt ||
      job.leaseExpiresAt <= now
    ) {
      return { state: "owner-lost", job, transcript: null };
    }

    const willRetry = params.retryable && job.attempt < job.maxAttempts;
    const nextAttemptAt = willRetry
      ? new Date(now.getTime() + retryDelayMs)
      : null;
    const jobStatus = willRetry ? "RETRY_WAIT" : "FAILED";
    await transaction.asyncJob.update({
      where: { id: job.id },
      data: {
        status: jobStatus,
        leaseExpiresAt: null,
        nextAttemptAt,
        errorMessage: params.errorMessage.slice(0, 500),
      },
    });
    await transaction.trainingTranscript.updateMany({
      where: {
        recordingId: params.recordingId,
        revision: params.revision,
        status: "PROCESSING",
        source: "ASR_PROVIDER",
      },
      data: {
        status: willRetry ? "PENDING" : "FAILED",
        errorMessage: params.errorMessage.slice(0, 500),
        completedAt: willRetry ? null : now,
      },
    });
    const transcript = await transaction.trainingTranscript.findUnique({
      where: { recordingId: params.recordingId },
      select: transcriptSelect,
    });
    return {
      state: willRetry ? "retry-scheduled" : "failed",
      job: await transaction.asyncJob.findUnique({ where: { id: job.id } }),
      transcript,
    };
  });
}
