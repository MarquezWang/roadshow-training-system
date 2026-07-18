import type { TrainingTranscript } from "@/lib/use-pitch-transcript";

export type TrainingRecording = {
  id: string;
  phase: string;
  status: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  durationSec: number | null;
  startedAt: string | null;
  endedAt: string | null;
  playbackUrl: string;
  transcript: TrainingTranscript | null;
};

export type RecordingStatus =
  | "UNDECIDED"
  | "READY_TO_RECORD"
  | "OPTED_OUT"
  | "RECORDING"
  | "SAVING"
  | "SAVED"
  | "FAILED"
  | "UNSUPPORTED"
  | "PERMISSION_DENIED";

export type SavedPitchRecording = {
  id: string;
  playbackUrl: string;
  mimeType: string;
};

export type UsePitchRecordingOptions = {
  sessionId: string;
  initialStatus: string;
  initialRecording: TrainingRecording | null;
  autoStartRecordingOnMount: boolean;
  isPitching: boolean;
  isGuardResolved: boolean;
  onRecordingSaved?: (recording: SavedPitchRecording) => void;
};
