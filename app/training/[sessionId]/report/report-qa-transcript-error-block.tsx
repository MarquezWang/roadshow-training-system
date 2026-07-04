import {
  canRetryTranscript,
  formatTranscriptErrorMessage,
} from "@/lib/transcript-error-message";

export function ReportQaTranscriptErrorBlock({
  recordingId,
  errorMessage,
  isAborted,
  isTranscribing,
  onRetryQaTranscribe,
}: Readonly<{
  recordingId: string;
  errorMessage: string | null | undefined;
  isAborted: boolean;
  isTranscribing: boolean;
  onRetryQaTranscribe: (recordingId: string) => void;
}>) {
  return (
    <details className="rounded-md border border-red-100 bg-red-50/30 p-3">
      <summary className="cursor-pointer text-xs text-red-500">
        查看错误详情
      </summary>
      <p className="mt-1 text-xs text-red-400">
        {formatTranscriptErrorMessage(errorMessage ?? null)}
      </p>
      {!isAborted ? (
        canRetryTranscript(errorMessage ?? null) ? (
          <button
            type="button"
            onClick={() => onRetryQaTranscribe(recordingId)}
            disabled={isTranscribing}
            className="mt-2 inline-flex h-7 items-center justify-center rounded border border-red-200 bg-white px-2 text-xs text-red-600 transition-colors hover:bg-red-50 disabled:cursor-not-allowed disabled:text-slate-400"
          >
            {isTranscribing ? "转写中..." : "重试转写"}
          </button>
        ) : (
          <p className="mt-1 text-xs text-slate-400">当前失败类型不建议重试</p>
        )
      ) : null}
    </details>
  );
}
