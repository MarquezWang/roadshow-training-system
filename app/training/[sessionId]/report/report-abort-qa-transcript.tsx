import {
  canRetryTranscript,
  formatTranscriptErrorMessage,
} from "@/lib/transcript-error-message";
import type { AbortRecording } from "./report-abort";

export function AbortQaTranscript({
  recording,
  isExpanded,
  isTranscribing,
  onToggleTranscriptExpand,
  onRetryQaTranscribe,
}: Readonly<{
  recording: AbortRecording;
  isExpanded: boolean;
  isTranscribing: boolean;
  onToggleTranscriptExpand: (recordingId: string) => void;
  onRetryQaTranscribe: (recordingId: string) => void;
}>) {
  const transcript = recording.transcript;
  if (!transcript) return null;

  return (
    <div className="rounded-md border border-slate-200 bg-white p-3">
      <p className="text-xs text-slate-400">回答转写</p>
      {transcript.status === "COMPLETED" ? (
        <div className="mt-1">
          <div className="flex items-center gap-2">
            <span className="inline-flex h-1.5 w-1.5 rounded-full bg-emerald-400" />
            <span className="text-xs text-emerald-600">已转写</span>
          </div>
          {transcript.text ? (
            <div className="mt-2">
              <button
                type="button"
                onClick={() => onToggleTranscriptExpand(recording.id)}
                className="text-xs font-medium text-blue-600 hover:text-blue-700"
              >
                {isExpanded ? "收起转写文本" : "展开转写文本"}
              </button>
              {isExpanded ? (
                <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-slate-600">
                  {transcript.text}
                </p>
              ) : null}
            </div>
          ) : (
            <p className="mt-1 text-xs text-slate-400">
              转写已完成，但暂未生成本文。
            </p>
          )}
        </div>
      ) : transcript.status === "FAILED" ? (
        <div className="mt-1">
          <div className="flex items-center gap-2">
            <span className="inline-flex h-1.5 w-1.5 rounded-full bg-red-400" />
            <span className="text-xs text-red-600">转写失败</span>
          </div>
          {transcript.errorMessage ? (
            <p className="mt-1 text-xs text-red-400">
              {formatTranscriptErrorMessage(transcript.errorMessage)}
            </p>
          ) : null}
          {canRetryTranscript(transcript.errorMessage) ? (
            <button
              type="button"
              onClick={() => onRetryQaTranscribe(recording.id)}
              disabled={isTranscribing}
              className="mt-2 inline-flex h-7 items-center rounded border border-red-200 bg-white px-2.5 text-xs font-medium text-red-600 transition-colors hover:bg-red-50 disabled:cursor-not-allowed disabled:text-slate-400"
            >
              {isTranscribing ? "转写中..." : "重试转写"}
            </button>
          ) : (
            <p className="mt-1 text-xs text-slate-400">当前失败类型不建议重试</p>
          )}
        </div>
      ) : (
        <div className="mt-1">
          <div className="flex items-center gap-2">
            <div className="h-3 w-3 animate-spin rounded-full border-2 border-amber-200 border-t-amber-400" />
            <span className="text-xs text-amber-600">转写处理中</span>
          </div>
        </div>
      )}
    </div>
  );
}
