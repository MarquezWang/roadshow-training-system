export { ReportAbortOverviewTab } from "./report-abort-overview";
export { ReportAbortPitchTab } from "./report-abort-pitch";
export { ReportAbortQaTab } from "./report-abort-qa";

type AbortTranscript = {
  status: string;
  text: string;
  errorMessage: string | null;
};

export type AbortRecording = {
  id: string;
  playbackUrl: string;
  durationSec: number | null;
  transcript: AbortTranscript | null;
};
