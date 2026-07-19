export class TrainingAnalysisPublicationError extends Error {
  constructor(code) {
    super(code);
    this.name = "TrainingAnalysisPublicationError";
    this.code = code;
  }
}

export async function publishTrainingAnalysis(
  prisma,
  {
    jobKey,
    ownerToken,
    sessionId,
    analysisId,
    inputHash,
    data,
  },
) {
  return prisma.$transaction(async (tx) => {
    const job = await tx.asyncJob.findUnique({
      where: { jobKey },
      select: {
        id: true,
        jobType: true,
        resourceId: true,
        status: true,
        ownerToken: true,
        leaseExpiresAt: true,
      },
    });
    const now = new Date();
    if (
      !job ||
      job.jobType !== "TRAINING_ANALYSIS" ||
      job.resourceId !== sessionId ||
      job.status !== "RUNNING" ||
      job.ownerToken !== ownerToken ||
      !job.leaseExpiresAt ||
      job.leaseExpiresAt <= now
    ) {
      throw new TrainingAnalysisPublicationError("analysis_job_owner_lost");
    }

    const settledJob = await tx.asyncJob.updateMany({
      where: {
        id: job.id,
        jobType: "TRAINING_ANALYSIS",
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
    if (settledJob.count !== 1) {
      throw new TrainingAnalysisPublicationError("analysis_job_owner_lost");
    }

    const completed = await tx.trainingAnalysis.updateMany({
      where: {
        id: analysisId,
        sessionId,
        status: "PROCESSING",
        inputHash,
      },
      data: {
        ...data,
        status: "COMPLETED",
      },
    });
    if (completed.count !== 1) {
      throw new TrainingAnalysisPublicationError(
        "analysis_publication_conflict",
      );
    }

    const pointed = await tx.trainingSession.updateMany({
      where: { id: sessionId },
      data: { currentAnalysisId: analysisId },
    });
    if (pointed.count !== 1) {
      throw new TrainingAnalysisPublicationError("analysis_session_missing");
    }

    return tx.trainingAnalysis.findUniqueOrThrow({
      where: { id: analysisId },
    });
  });
}
