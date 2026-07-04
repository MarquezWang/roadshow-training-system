import {
  canRetryTranscript,
  formatTranscriptErrorMessage,
} from "@/lib/transcript-error-message";
import type { QaRecording, QaTranscript } from "./report-qa-types";

type ReportQaRecordingBlockProps = Readonly<{
  recording: QaRecording;
  transcript: QaTranscript | null | undefined;
  isTranscribing: boolean;
  isExpanded: boolean;
  isAborted: boolean;
  onToggleTranscriptExpand: (recordingId: string) => void;
  onRetryQaTranscribe: (recordingId: string) => void;
}>;

export function ReportQaRecordingBlock({
  recording,
  transcript,
  isTranscribing,
  isExpanded,
  isAborted,
  onToggleTranscriptExpand,
  onRetryQaTranscribe,
}: ReportQaRecordingBlockProps) {
  const status = transcript?.status ?? "PENDING";
  const statusLabel =
    status === "COMPLETED"
      ? "已转写"
      : status === "FAILED"
        ? "转写失败"
        : status === "PROCESSING" || isTranscribing
          ? "转写中"
          : "等待中";
  const statusColor =
    status === "COMPLETED"
      ? "text-emerald-600"
      : status === "FAILED"
        ? "text-red-500"
        : "text-amber-600";
  const hasText = status === "COMPLETED" && transcript?.text?.trim();
  const textPreview =
    hasText && transcript ? transcript.text.slice(0, 150) : "";
  const fullText = transcript?.text ?? "";

  return (
    <div className="mt-3 space-y-2">
      <div className="rounded-md border border-slate-100 bg-slate-50/50 p-3">
        <div className="flex items-center justify-between">
          <p className="text-xs font-medium text-slate-500">
            回答录音
            {recording.durationSec !== null ? `（${recording.durationSec} 秒）` : ""}
          </p>
          <span className={`text-xs ${statusColor}`}>{statusLabel}</span>
        </div>
        <audio controls src={recording.playbackUrl} className="mt-2 w-full">
          <track kind="captions" />
        </audio>
      </div>

      {hasText ? (
        <div className="rounded-md border border-slate-100 bg-slate-50/50 p-3">
          {isExpanded ? (
            <>
              <p className="whitespace-pre-wrap text-sm leading-6 text-slate-700">
                {fullText}
              </p>
              <button
                type="button"
                onClick={() => onToggleTranscriptExpand(recording.id)}
                className="mt-2 text-xs font-medium text-blue-500 transition-colors hover:text-blue-700"
              >
                收起
              </button>
            </>
          ) : (
            <>
              <p className="text-sm leading-6 text-slate-600">
                {textPreview}
                {fullText.length > 150 ? "..." : ""}
              </p>
              <button
                type="button"
                onClick={() => onToggleTranscriptExpand(recording.id)}
                className="mt-1 text-xs font-medium text-blue-500 transition-colors hover:text-blue-700"
              >
                展开完整转写
              </button>
            </>
          )}
        </div>
      ) : null}

      {status === "FAILED" ? (
        <details className="rounded-md border border-red-100 bg-red-50/30 p-3">
          <summary className="cursor-pointer text-xs text-red-500">
            查看错误详情
          </summary>
          <p className="mt-1 text-xs text-red-400">
            {formatTranscriptErrorMessage(transcript?.errorMessage ?? null)}
          </p>
          {!isAborted ? (
            canRetryTranscript(transcript?.errorMessage ?? null) ? (
              <button
                type="button"
                onClick={() => onRetryQaTranscribe(recording.id)}
                disabled={isTranscribing}
                className="mt-2 inline-flex h-7 items-center justify-center rounded border border-red-200 bg-white px-2 text-xs text-red-600 transition-colors hover:bg-red-50 disabled:cursor-not-allowed disabled:text-slate-400"
              >
                {isTranscribing ? "转写中..." : "重试转写"}
              </button>
            ) : (
              <p className="mt-1 text-xs text-slate-400">
                当前失败类型不建议重试
              </p>
            )
          ) : null}
        </details>
      ) : null}

      {status !== "COMPLETED" && status !== "FAILED" ? (
        <p className="text-xs text-slate-400">
          {isTranscribing ? "转写进行中，请稍后刷新..." : "等待转写完成..."}
        </p>
      ) : null}
    </div>
  );
}
