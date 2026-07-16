import type { RecordingStatus } from "@/lib/use-pitch-recording";
import type {
  TrainingTranscript,
  TranscribeStatus,
} from "@/lib/use-pitch-transcript";

type TrainingTranscriptPanelProps = Readonly<{
  isEnded: boolean;
  recordingStatus: RecordingStatus;
  canShowTranscriptEditor: boolean;
  transcript: TrainingTranscript | null;
  transcriptDraft: string;
  isTranscriptEditing: boolean;
  isTranscriptSaving: boolean;
  transcriptMessage: string;
  transcribeStatus: TranscribeStatus;
  transcribeErrorMessage: string;
  onRetryTranscribe: () => void | Promise<void>;
  onStartEditing: () => void;
  onCancelEditing: () => void;
  onTranscriptDraftChange: (value: string) => void;
  onSaveTranscript: () => void | Promise<void>;
}>;

export function TrainingTranscriptPanel({
  isEnded,
  recordingStatus,
  canShowTranscriptEditor,
  transcript,
  transcriptDraft,
  isTranscriptEditing,
  isTranscriptSaving,
  transcriptMessage,
  transcribeStatus,
  transcribeErrorMessage,
  onRetryTranscribe,
  onStartEditing,
  onCancelEditing,
  onTranscriptDraftChange,
  onSaveTranscript,
}: TrainingTranscriptPanelProps) {
  const transcriptBoxClassName =
    "mt-4 rounded-md border border-slate-200 bg-slate-50 p-3";

  return (
    <>
      {transcribeStatus !== "idle" ? (
        <div className={transcriptBoxClassName}>
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold text-slate-950">自动转写</h3>
            {transcribeStatus === "transcribing" ? (
              <span className="text-xs text-blue-600">转写中…</span>
            ) : transcribeStatus === "completed" ? (
              <span className="text-xs text-green-600">转写完成</span>
            ) : (
              <span className="text-xs text-red-600">转写失败</span>
            )}
          </div>
          {transcribeStatus === "transcribing" ? (
            <p className="mt-2 text-xs leading-5 text-slate-600">
              正在自动转写路演语音内容，请稍候…
            </p>
          ) : transcribeStatus === "failed" ? (
            <div className="mt-2">
              <p className="text-xs leading-5 text-red-600">
                {transcribeErrorMessage || "自动转写失败，可重试。"}
              </p>
              <button
                type="button"
                onClick={() => void onRetryTranscribe()}
                className="mt-2 rounded-md border border-blue-300 bg-blue-50 px-3 py-1 text-xs text-blue-700 hover:bg-blue-100"
              >
                重试转写
              </button>
            </div>
          ) : null}
        </div>
      ) : null}

      {canShowTranscriptEditor ? (
        <div className={transcriptBoxClassName}>
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <h3 className="text-sm font-semibold text-slate-950">转写文本</h3>
            {transcript && !isTranscriptEditing ? (
              <button
                type="button"
                onClick={onStartEditing}
                className="inline-flex h-8 items-center justify-center rounded-md border border-slate-300 bg-white px-3 text-xs font-medium text-slate-700 transition-colors hover:bg-slate-50"
              >
                编辑转写文本
              </button>
            ) : null}
          </div>
          {isTranscriptEditing ? (
            <div className="mt-3 grid gap-3">
              {!transcript ? (
                <p className="text-xs leading-5 text-slate-600">
                  当前暂未接入自动转写，可先粘贴人工整理文本。
                </p>
              ) : null}
              <textarea
                value={transcriptDraft}
                onChange={(event) =>
                  onTranscriptDraftChange(event.target.value)
                }
                rows={7}
                className="w-full resize-y rounded-md border border-slate-300 bg-white p-3 text-sm leading-6 text-slate-900 outline-none transition-colors placeholder:text-slate-400 focus:border-slate-500"
                placeholder="粘贴或编辑人工整理后的路演转写文本"
              />
              <div className="flex flex-col gap-2 sm:flex-row sm:justify-end">
                {transcript ? (
                  <button
                    type="button"
                    onClick={onCancelEditing}
                    disabled={isTranscriptSaving}
                    className="inline-flex h-9 items-center justify-center rounded-md border border-slate-300 bg-white px-3 text-xs font-medium text-slate-700 transition-colors hover:bg-slate-50 disabled:cursor-not-allowed disabled:text-slate-400"
                  >
                    取消编辑
                  </button>
                ) : null}
                <button
                  type="button"
                  onClick={() => void onSaveTranscript()}
                  disabled={isTranscriptSaving}
                  className="inline-flex h-9 items-center justify-center rounded-md bg-slate-950 px-3 text-xs font-medium text-white transition-colors hover:bg-slate-800 disabled:cursor-not-allowed disabled:bg-slate-300"
                >
                  {isTranscriptSaving ? "保存中..." : "保存转写文本"}
                </button>
              </div>
            </div>
          ) : transcript ? (
            <p className="mt-3 whitespace-pre-wrap text-sm leading-6 text-slate-700">
              {transcript.text}
            </p>
          ) : null}
          {transcriptMessage ? (
            <p className="mt-3 text-xs leading-5 text-slate-600">
              {transcriptMessage}
            </p>
          ) : null}
        </div>
      ) : isEnded &&
        (recordingStatus === "OPTED_OUT" ||
          recordingStatus === "PERMISSION_DENIED" ||
          recordingStatus === "UNSUPPORTED") ? (
        <p className="mt-3 rounded-md border border-slate-200 bg-slate-50 p-3 text-xs leading-5 text-slate-600">
          本次未启用录音，暂无转写文本。
        </p>
      ) : null}
    </>
  );
}
