import type { QaRecording, QaTranscript } from "./report-qa-types";
import { ReportQaTranscriptErrorBlock } from "./report-qa-transcript-error-block";
import { ReportQaTranscriptTextBlock } from "./report-qa-transcript-text-block";

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
        <ReportQaTranscriptTextBlock
          recordingId={recording.id}
          isExpanded={isExpanded}
          textPreview={textPreview}
          fullText={fullText}
          onToggleTranscriptExpand={onToggleTranscriptExpand}
        />
      ) : null}

      {status === "FAILED" ? (
        <ReportQaTranscriptErrorBlock
          recordingId={recording.id}
          errorMessage={transcript?.errorMessage}
          isAborted={isAborted}
          isTranscribing={isTranscribing}
          onRetryQaTranscribe={onRetryQaTranscribe}
        />
      ) : null}

      {status !== "COMPLETED" && status !== "FAILED" ? (
        <p className="text-xs text-slate-400">
          {isTranscribing ? "转写进行中，请稍后刷新..." : "等待转写完成..."}
        </p>
      ) : null}
    </div>
  );
}
