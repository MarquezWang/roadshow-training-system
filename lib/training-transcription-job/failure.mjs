import { transcriptSelect } from "./constants.mjs";

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
