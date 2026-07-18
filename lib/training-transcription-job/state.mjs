import { transcriptSelect } from "./constants.mjs";

export function isCompletedTranscript(transcript) {
  return transcript?.status === "COMPLETED" && Boolean(transcript.text.trim());
}

export function isUniqueConstraintError(error) {
  return Boolean(error && typeof error === "object" && error.code === "P2002");
}

export async function readCurrentState(prisma, recordingId, jobKey) {
  const [job, transcript] = await Promise.all([
    prisma.asyncJob.findUnique({ where: { jobKey } }),
    prisma.trainingTranscript.findUnique({
      where: { recordingId },
      select: transcriptSelect,
    }),
  ]);
  return { job, transcript };
}

export async function settleCompletedTranscriptJob(prisma, jobKey) {
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

export async function markAttemptLimitReached(prisma, params) {
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
