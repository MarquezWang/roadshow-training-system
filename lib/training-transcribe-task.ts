import { trainingTranscriptionJobKey } from "@/lib/training-transcription-job.mjs";

export {
  getErrorSummary,
  isRetryableTranscribeError,
  TranscribeHttpError,
} from "./training-transcribe/errors";
export {
  recoverDueTrainingTranscriptions,
  recoverTrainingTranscriptionsForSession,
  startTrainingTranscriptionRecoveryWorker,
} from "./training-transcribe/recovery";
export {
  runTranscriptionWithLock,
  startTranscriptionTask,
} from "./training-transcribe/runner";
export { transcriptSelect } from "./training-transcribe/types";
export type { TranscriptionRunResult } from "./training-transcribe/types";

export function transcriptionJobKeyForRecording(recordingId: string) {
  return trainingTranscriptionJobKey(recordingId);
}
