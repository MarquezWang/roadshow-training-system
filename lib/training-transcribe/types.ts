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
} as const;

export type TrainingTranscript = {
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
  revision: number;
};

export type TranscriptionTarget = {
  id: string;
  sessionId: string;
  projectId: string;
  phase: string;
  filePath: string;
  mimeType: string;
  transcript: TrainingTranscript | null;
  absolutePath: string;
};

export type AcquiredTranscriptionJob = {
  state: "acquired";
  ownerToken: string;
  job: {
    jobKey: string;
    attempt: number;
    maxAttempts: number;
  };
  transcript: TrainingTranscript;
};

export type TranscriptionRunResult =
  | {
      kind: "completed";
      transcript: TrainingTranscript;
    }
  | {
      kind: "pending";
      message: string;
      transcript: TrainingTranscript;
    }
  | {
      kind: "business-failed";
      message: string;
      transcript: TrainingTranscript;
    }
  | {
      kind: "system-failed";
      message: string;
      transcript: TrainingTranscript;
    };
