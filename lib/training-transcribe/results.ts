import { TranscribeHttpError } from "./errors";
import type {
  TrainingTranscript,
  TranscriptionRunResult,
} from "./types";

export function resultForUnacquiredJob(
  state: string,
  transcript: TrainingTranscript | null,
  errorMessage?: string | null,
): TranscriptionRunResult {
  if (!transcript) {
    throw new TranscribeHttpError("无法创建转写任务。", 500);
  }
  if (transcript.status === "COMPLETED" && transcript.text.trim()) {
    return { kind: "completed", transcript };
  }
  if (state === "exhausted" || transcript.status === "FAILED") {
    return {
      kind: "system-failed",
      message: errorMessage ?? transcript.errorMessage ?? "自动转写失败。",
      transcript,
    };
  }
  return {
    kind: "pending",
    message:
      state === "backoff"
        ? "转写任务正在等待自动重试。"
        : state === "queued"
          ? "转写任务已加入后台队列。"
        : "转写任务已由其他处理器接管。",
    transcript,
  };
}
