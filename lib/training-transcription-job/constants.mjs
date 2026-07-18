export const TRAINING_TRANSCRIPTION_JOB_TYPE = "TRAINING_TRANSCRIPTION";
export const DEFAULT_TRANSCRIPTION_MAX_ATTEMPTS = 3;
export const DEFAULT_TRANSCRIPTION_LEASE_MS = 5 * 60_000;

export const transcriptSelect = {
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
