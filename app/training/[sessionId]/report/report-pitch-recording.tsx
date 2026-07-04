export type PitchTranscript = {
  text: string;
  source: string;
};

export type PitchRecording = {
  playbackUrl: string;
  durationSec: number | null;
};

export function ReportPitchRecording({
  recording,
  transcript,
  isAborted,
  isTranscriptEditing,
  isTranscriptSaving,
  transcriptDraft,
  transcriptExpanded,
  transcriptMessage,
  onStartTranscriptEditing,
  onToggleTranscriptExpanded,
  onTranscriptDraftChange,
  onCancelTranscriptEditing,
  onSaveTranscript,
}: Readonly<{
  recording: PitchRecording | null;
  transcript: PitchTranscript | null;
  isAborted: boolean;
  isTranscriptEditing: boolean;
  isTranscriptSaving: boolean;
  transcriptDraft: string;
  transcriptExpanded: boolean;
  transcriptMessage: string;
  onStartTranscriptEditing: () => void;
  onToggleTranscriptExpanded: () => void;
  onTranscriptDraftChange: (value: string) => void;
  onCancelTranscriptEditing: () => void;
  onSaveTranscript: () => void;
}>) {
  return recording ? (
    <section className="rounded-lg border border-slate-100 bg-white p-6">
      <h3 className="text-sm font-semibold text-slate-800">
        路演录音与转写
      </h3>
      <p className="mt-1 text-xs text-slate-400">原始录音回放与转写文本。</p>

      <div className="mt-4 grid gap-4">
        <div className="rounded-md border border-slate-100 bg-slate-50/50 p-4">
          <p className="text-xs font-medium text-slate-500">路演录音回放</p>
          <audio controls src={recording.playbackUrl} className="mt-2 w-full">
            <track kind="captions" />
          </audio>
          <p className="mt-1 text-xs text-slate-400">
            {recording.durationSec !== null
              ? `录音时长 ${recording.durationSec} 秒`
              : "录音时长未记录"}
          </p>
        </div>

        <div className="rounded-md border border-slate-100 bg-slate-50/50 p-4">
          <div className="flex items-center justify-between">
            <h4 className="text-sm font-medium text-slate-700">
              路演转写文本
              {transcript ? (
                <span className="ml-2 text-xs font-normal text-slate-400">
                  {transcript.source === "ASR_PROVIDER"
                    ? "（自动转写）"
                    : "（手动输入）"}
                </span>
              ) : null}
            </h4>
            <div className="flex items-center gap-2">
              {transcript && !isTranscriptEditing && !isAborted ? (
                <button
                  type="button"
                  onClick={onStartTranscriptEditing}
                  className="text-xs font-medium text-slate-400 transition-colors hover:text-slate-600"
                >
                  编辑
                </button>
              ) : null}
              {transcript && !isTranscriptEditing ? (
                <button
                  type="button"
                  onClick={onToggleTranscriptExpanded}
                  className="text-xs font-medium text-blue-500 transition-colors hover:text-blue-700"
                >
                  {transcriptExpanded ? "收起" : "展开"}
                </button>
              ) : null}
            </div>
          </div>

          {isTranscriptEditing && !isAborted ? (
            <div className="mt-3 grid gap-3">
              <textarea
                value={transcriptDraft}
                onChange={(event) => onTranscriptDraftChange(event.target.value)}
                rows={8}
                className="w-full resize-y rounded-md border border-slate-200 bg-white p-3 text-sm leading-6 text-slate-900 outline-none transition-colors placeholder:text-slate-400 focus:border-slate-400"
                placeholder="粘贴或编辑路演转写文本"
              />
              <div className="flex flex-col gap-2 sm:flex-row sm:justify-end">
                {transcript ? (
                  <button
                    type="button"
                    onClick={onCancelTranscriptEditing}
                    disabled={isTranscriptSaving}
                    className="inline-flex h-8 items-center justify-center rounded-md border border-slate-200 bg-white px-3 text-xs font-medium text-slate-600 transition-colors hover:bg-slate-50 disabled:cursor-not-allowed disabled:text-slate-400"
                  >
                    取消
                  </button>
                ) : null}
                <button
                  type="button"
                  onClick={onSaveTranscript}
                  disabled={isTranscriptSaving}
                  className="inline-flex h-8 items-center justify-center rounded-md bg-slate-900 px-3 text-xs font-medium text-white transition-colors hover:bg-slate-800 disabled:cursor-not-allowed disabled:bg-slate-300"
                >
                  {isTranscriptSaving ? "保存中..." : "保存"}
                </button>
              </div>
            </div>
          ) : transcript && transcriptExpanded ? (
            <p className="mt-3 whitespace-pre-wrap text-sm leading-6 text-slate-700">
              {transcript.text}
            </p>
          ) : transcript ? (
            <p className="mt-3 text-sm text-slate-400">
              转写文本已折叠，点击&ldquo;展开&rdquo;查看完整内容。
            </p>
          ) : null}

          {transcriptMessage ? (
            <p className="mt-3 text-xs text-slate-500">{transcriptMessage}</p>
          ) : null}
        </div>
      </div>

      <p className="mt-4 text-xs text-slate-400">
        逐页讲解时间轴与分页面建议将在后续版本中完善。
      </p>
    </section>
  ) : (
    <section className="rounded-lg border border-slate-100 bg-white p-6">
      <p className="text-sm text-slate-500">本轮没有路演录音记录。</p>
    </section>
  );
}
