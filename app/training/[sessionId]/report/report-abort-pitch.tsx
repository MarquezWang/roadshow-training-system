import { formatTranscriptErrorMessage } from "@/lib/transcript-error-message";
import type { AbortRecording } from "./report-abort";

type ReportAbortPitchTabProps = Readonly<{
  recording: AbortRecording | null;
  transcriptExpanded: boolean;
  onToggleTranscriptExpanded: () => void;
}>;

export function ReportAbortPitchTab({
  recording,
  transcriptExpanded,
  onToggleTranscriptExpanded,
}: ReportAbortPitchTabProps) {
  return (
    <div className="grid gap-6">
      <section className="rounded-lg border border-slate-100 bg-white p-6">
        <h2 className="text-sm font-semibold text-slate-800">路演记录</h2>
        <p className="mt-1 text-xs text-slate-400">
          训练中止前已保存的路演录音与转写内容。
        </p>

        {recording ? (
          <div className="mt-4 grid gap-4">
            <div className="rounded-md border border-slate-100 bg-slate-50/50 p-4">
              <p className="text-xs font-medium text-slate-500">路演录音</p>
              <div className="mt-2">
                <audio
                  controls
                  className="h-10 w-full"
                  src={recording.playbackUrl}
                  preload="metadata"
                />
              </div>
              {recording.durationSec != null ? (
                <p className="mt-1 text-xs text-slate-400">
                  时长：{Math.round(recording.durationSec)} 秒
                </p>
              ) : null}
            </div>

            <div className="rounded-md border border-slate-100 bg-slate-50/50 p-4">
              <p className="text-xs font-medium text-slate-500">路演转写</p>
              {recording.transcript ? (
                recording.transcript.status === "COMPLETED" ? (
                  <div className="mt-2">
                    <div className="flex items-center gap-2">
                      <span className="inline-flex h-1.5 w-1.5 rounded-full bg-emerald-400" />
                      <span className="text-xs text-emerald-600">已转写</span>
                    </div>
                    {recording.transcript.text ? (
                      <div className="mt-2">
                        <button
                          type="button"
                          onClick={onToggleTranscriptExpanded}
                          className="text-xs font-medium text-blue-600 hover:text-blue-700"
                        >
                          {transcriptExpanded ? "收起转写文本" : "展开转写文本"}
                        </button>
                        {transcriptExpanded ? (
                          <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-slate-600">
                            {recording.transcript.text}
                          </p>
                        ) : null}
                      </div>
                    ) : (
                      <p className="mt-1 text-xs text-slate-400">
                        转写已完成，但暂未生成本文。
                      </p>
                    )}
                  </div>
                ) : recording.transcript.status === "FAILED" ? (
                  <div className="mt-2">
                    <div className="flex items-center gap-2">
                      <span className="inline-flex h-1.5 w-1.5 rounded-full bg-red-400" />
                      <span className="text-xs text-red-600">转写失败</span>
                    </div>
                    {recording.transcript.errorMessage ? (
                      <p className="mt-1 text-xs text-red-400">
                        {formatTranscriptErrorMessage(
                          recording.transcript.errorMessage,
                        )}
                      </p>
                    ) : null}
                  </div>
                ) : (
                  <div className="mt-2">
                    <div className="flex items-center gap-2">
                      <div className="h-3 w-3 animate-spin rounded-full border-2 border-amber-200 border-t-amber-400" />
                      <span className="text-xs text-amber-600">转写处理中</span>
                    </div>
                  </div>
                )
              ) : (
                <p className="mt-2 text-xs text-slate-400">
                  暂未生成转写文本。
                </p>
              )}
            </div>
          </div>
        ) : (
          <p className="mt-4 rounded-md border border-dashed border-slate-200 p-4 text-sm text-slate-400">
            本轮训练未保存路演录音，可能是在录音保存前中止。
          </p>
        )}
      </section>
    </div>
  );
}
