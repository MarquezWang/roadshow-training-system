import {
  DEFAULT_TRANSCRIPTION_MAX_ATTEMPTS,
  trainingTranscriptionJobKey,
  transcriptSelect,
} from "./constants.mjs";
import {
  ensureTranscriptionJob,
  getDeferredAcquisitionState,
  resetCompletedJob,
  resetForcedRetry,
} from "./ownership.mjs";
import {
  isCompletedTranscript,
  isUniqueConstraintError,
  readCurrentState,
  settleCompletedTranscriptJob,
} from "./state.mjs";

async function ensurePendingTranscript(prisma, recording, transcript) {
  if (transcript) return transcript;

  try {
    return await prisma.trainingTranscript.create({
      data: {
        recordingId: recording.id,
        sessionId: recording.sessionId,
        projectId: recording.projectId,
        status: "PENDING",
        source: "ASR_PROVIDER",
        language: "zh-CN",
        text: "",
      },
      select: transcriptSelect,
    });
  } catch (error) {
    if (!isUniqueConstraintError(error)) throw error;
    return prisma.trainingTranscript.findUnique({
      where: { recordingId: recording.id },
      select: transcriptSelect,
    });
  }
}

async function resetFailedTranscriptForRetry(prisma, transcript) {
  if (!transcript || transcript.status !== "FAILED") return transcript;

  await prisma.trainingTranscript.updateMany({
    where: {
      id: transcript.id,
      revision: transcript.revision,
      status: "FAILED",
      source: { not: "MANUAL" },
    },
    data: {
      status: "PENDING",
      source: "ASR_PROVIDER",
      errorMessage: null,
      startedAt: null,
      completedAt: null,
      revision: { increment: 1 },
    },
  });
  return prisma.trainingTranscript.findUnique({
    where: { id: transcript.id },
    select: transcriptSelect,
  });
}

export async function queueTrainingTranscriptionJob(prisma, params) {
  const now = params.now ?? new Date();
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

  await ensureTranscriptionJob(prisma, {
    jobKey,
    recordingId: recording.id,
    maxAttempts,
  });
  let { job, transcript } = await readCurrentState(
    prisma,
    recording.id,
    jobKey,
  );

  if (!job) {
    throw new Error("transcription_job_missing_after_queue");
  }

  if (
    params.forceRetry &&
    (job.status === "FAILED" || job.status === "COMPLETED")
  ) {
    ({ job, transcript } = await resetForcedRetry(prisma, {
      job,
      recordingId: recording.id,
      jobKey,
      maxAttempts,
    }));
    transcript = await resetFailedTranscriptForRetry(prisma, transcript);
  } else if (job.status === "COMPLETED") {
    job = await resetCompletedJob(prisma, job, maxAttempts);
  }

  transcript = await ensurePendingTranscript(prisma, recording, transcript);
  if (!job || !transcript) {
    throw new Error("transcription_queue_state_missing");
  }

  const deferredState = getDeferredAcquisitionState(job, now);
  return {
    state:
      deferredState ??
      (job.status === "PENDING" ? "queued" : job.status.toLowerCase()),
    job,
    transcript,
  };
}
