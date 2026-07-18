import {
  DEFAULT_TRANSCRIPTION_LEASE_MS,
  DEFAULT_TRANSCRIPTION_MAX_ATTEMPTS,
  trainingTranscriptionJobKey,
  transcriptSelect,
} from "./constants.mjs";
import {
  claimTranscriptionJob,
  ensureTranscriptionJob,
  getDeferredAcquisitionState,
  isAcquisitionEligible,
  resetCompletedJob,
  resetForcedRetry,
} from "./ownership.mjs";
import {
  isCompletedTranscript,
  markAttemptLimitReached,
  readCurrentState,
  settleCompletedTranscriptJob,
} from "./state.mjs";
import { prepareProcessingTranscript } from "./transcript.mjs";

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
    throw new Error("transcription_job_missing_after_create");
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
  }

  if (!job) {
    throw new Error("transcription_job_missing_before_acquire");
  }

  if (isCompletedTranscript(transcript)) {
    await settleCompletedTranscriptJob(prisma, jobKey);
    return { state: "completed", job, transcript };
  }

  const deferredState = getDeferredAcquisitionState(job, now);
  if (deferredState) {
    return { state: deferredState, job, transcript };
  }

  if (job.status === "COMPLETED") {
    job = await resetCompletedJob(prisma, job, maxAttempts);
  }

  if (job.attempt >= maxAttempts) {
    await markAttemptLimitReached(prisma, { job, transcript, now });
    const current = await readCurrentState(prisma, recording.id, jobKey);
    return { state: "exhausted", ...current };
  }

  if (!isAcquisitionEligible(job, now)) {
    return { state: "inactive", job, transcript };
  }

  const { acquired, ownerToken } = await claimTranscriptionJob(prisma, {
    job,
    now,
    leaseMs,
    maxAttempts,
  });

  if (!acquired) {
    const current = await readCurrentState(prisma, recording.id, jobKey);
    return { state: "active", ...current };
  }

  const processingTranscript = await prepareProcessingTranscript(prisma, {
    recording,
    transcript,
    now,
  });

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
