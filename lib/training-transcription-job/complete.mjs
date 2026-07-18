import { transcriptSelect } from "./constants.mjs";

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
