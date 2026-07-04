import type { TrainingRecording, TrainingTranscript } from "./report-types";

export type SourceTranscript = Readonly<{
  id: string;
  recordingId: string;
  sessionId: string;
  status: string;
  source: string;
  language: string;
  text: string;
  segmentsJson: string | null;
  errorMessage: string | null;
  startedAt: Date | null;
  completedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}>;

export type SourceRecording = Readonly<{
  id: string;
  phase: string;
  mimeType: string;
  sizeBytes: number;
  durationSec: number | null;
  transcript: SourceTranscript | null;
}>;

function normalizeTranscript(transcript: SourceTranscript): TrainingTranscript {
  return {
    ...transcript,
    startedAt: transcript.startedAt?.toISOString() ?? null,
    completedAt: transcript.completedAt?.toISOString() ?? null,
    createdAt: transcript.createdAt.toISOString(),
    updatedAt: transcript.updatedAt.toISOString(),
  };
}

export function normalizeRecording(
  sessionId: string,
  recording: SourceRecording,
): TrainingRecording {
  return {
    ...recording,
    playbackUrl: `/training/${sessionId}/recordings/${recording.id}`,
    transcript: recording.transcript
      ? normalizeTranscript(recording.transcript)
      : null,
  };
}

export function normalizePitchRecording(
  sessionId: string,
  recordings: readonly SourceRecording[],
) {
  const pitchRecording =
    recordings.find(
      (recording) => recording.phase === "PITCH" && recording.transcript,
    ) ?? recordings.find((recording) => recording.phase === "PITCH") ?? null;

  return pitchRecording ? normalizeRecording(sessionId, pitchRecording) : null;
}
