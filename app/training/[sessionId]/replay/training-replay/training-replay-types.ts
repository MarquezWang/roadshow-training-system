export type ReplayPreviewFile = {
  id: string;
  originalName: string;
  fileType: string;
  previewPdfPath?: string | null;
  previewStatus?: string | null;
  previewError?: string | null;
  displaySource?: "PDF" | "POWERPOINT_PREVIEW";
};

export type ReplaySlideEvent = {
  id: string;
  fileId: string | null;
  pageIndex: number;
  eventType: string;
  elapsedSec: number;
  createdAt: string;
};

export type ReplayTranscript = {
  id: string;
  recordingId: string;
  sessionId: string;
  status: string;
  source: string;
  language: string;
  text: string;
  segmentsJson: string | null;
  segmentsSchemaVersion: string;
  errorMessage: string | null;
  startedAt: string | null;
  completedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type ReplayRecording = {
  id: string;
  phase: string;
  playbackUrl: string;
  mimeType: string;
  sizeBytes: number;
  durationSec: number | null;
  startedAt?: string | null;
  endedAt?: string | null;
  transcript: ReplayTranscript | null;
};

export type PitchReplaySegment = {
  pageIndex: number;
  startSec: number;
  endSec: number;
  durationSec: number;
  ranges: Array<{
    startSec: number;
    endSec: number;
  }>;
};

export type TranscriptSegment = {
  startMs: number;
  endMs: number;
  text: string;
  speakerId?: string | null;
};

export type ReplayTranscriptExcerpt = {
  text: string;
  matchType: "precise" | "estimated" | "none";
};

export type ReplayPageControlItem = number | "ellipsis";
