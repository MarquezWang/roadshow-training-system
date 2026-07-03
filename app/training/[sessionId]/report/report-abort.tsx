import {
  canRetryTranscript,
  formatTranscriptErrorMessage,
} from "@/lib/transcript-error-message";

type AbortTranscript = {
  status: string;
  text: string;
  errorMessage: string | null;
};

type AbortRecording = {
  id: string;
  playbackUrl: string;
  durationSec: number | null;
  transcript: AbortTranscript | null;
};

type AbortQaQuestion = {
  id: string;
  orderIndex: number;
  questionText: string;
  answer: {
    answerText: string | null;
    startedAt: string | null;
    endedAt: string | null;
    durationSec: number | null;
    recording: AbortRecording | null;
  } | null;
};

type ReportAbortOverviewTabProps = Readonly<{
  recording: AbortRecording | null;
  qaQuestions: AbortQaQuestion[];
}>;

type ReportAbortPitchTabProps = Readonly<{
  recording: AbortRecording | null;
  transcriptExpanded: boolean;
  onToggleTranscriptExpanded: () => void;
}>;

type ReportAbortQaTabProps = Readonly<{
  qaQuestions: AbortQaQuestion[];
  expandedTranscripts: Set<string>;
  qaTranscribingSet: Set<string>;
  onToggleTranscriptExpand: (recordingId: string) => void;
  onRetryQaTranscribe: (recordingId: string) => void;
}>;

function hasEnteredQaQuestion(question: AbortQaQuestion) {
  return Boolean(
    question.answer?.startedAt ||
      question.answer?.endedAt ||
      question.answer?.recording ||
      question.answer?.answerText?.trim(),
  );
}

function getQaTranscriptSummary(qaQuestions: AbortQaQuestion[]) {
  const answered = qaQuestions.filter((q) => q.answer?.recording?.transcript);
  if (answered.length === 0) return "暂无";

  const completed = answered.filter(
    (q) => q.answer!.recording!.transcript!.status === "COMPLETED",
  );
  const failed = answered.filter(
    (q) => q.answer!.recording!.transcript!.status === "FAILED",
  );
  const pending = answered.length - completed.length - failed.length;
  const parts: string[] = [];
  if (completed.length > 0) parts.push(`${completed.length} 题已转写`);
  if (pending > 0) parts.push(`${pending} 题处理中`);
  if (failed.length > 0) parts.push(`${failed.length} 题失败`);
  return parts.join("，") || "暂无";
}

export function ReportAbortOverviewTab({
  recording,
  qaQuestions,
}: ReportAbortOverviewTabProps) {
  return (
    <div className="grid gap-6">
      <section className="rounded-lg border border-slate-100 bg-white p-6">
        <div className="rounded-md border border-amber-100 bg-amber-50/70 p-5">
          <p className="text-sm font-semibold text-amber-800">
            本轮训练已中止
          </p>
          <p className="mt-2 text-sm leading-6 text-amber-700/80">
            本轮训练在进行中被中止，已完成内容会保留，但不能继续本轮路演或答辩。
          </p>
        </div>
        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          <div className="rounded-md border border-slate-100 bg-slate-50/50 p-3">
            <p className="text-xs text-slate-400">路演录音</p>
            <p className="mt-1 text-sm font-medium text-slate-700">
              {recording ? "已保存" : "未保存"}
            </p>
          </div>
          <div className="rounded-md border border-slate-100 bg-slate-50/50 p-3">
            <p className="text-xs text-slate-400">路演转写</p>
            <p className="mt-1 text-sm font-medium text-slate-700">
              {recording?.transcript
                ? recording.transcript.status === "COMPLETED"
                  ? "已转写"
                  : recording.transcript.status === "FAILED"
                    ? "转写失败"
                    : "转写处理中"
                : "未生成"}
            </p>
          </div>
          <div className="rounded-md border border-slate-100 bg-slate-50/50 p-3">
            <p className="text-xs text-slate-400">已进入答辩题数</p>
            <p className="mt-1 text-sm font-medium text-slate-700">
              {qaQuestions.filter(hasEnteredQaQuestion).length} /{" "}
              {qaQuestions.length}
            </p>
          </div>
          <div className="rounded-md border border-slate-100 bg-slate-50/50 p-3">
            <p className="text-xs text-slate-400">答辩回答转写</p>
            <p className="mt-1 text-sm font-medium text-slate-700">
              {getQaTranscriptSummary(qaQuestions)}
            </p>
          </div>
        </div>
      </section>
    </div>
  );
}

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

export function ReportAbortQaTab({
  qaQuestions,
  expandedTranscripts,
  qaTranscribingSet,
  onToggleTranscriptExpand,
  onRetryQaTranscribe,
}: ReportAbortQaTabProps) {
  const enteredQuestions = qaQuestions.filter(hasEnteredQaQuestion);

  return (
    <div className="grid gap-6">
      <section className="rounded-lg border border-slate-100 bg-white p-6">
        <h2 className="text-sm font-semibold text-slate-800">答辩记录</h2>
        <p className="mt-1 text-xs text-slate-400">
          训练中止前已进入并回答过的答辩问题。
        </p>

        {enteredQuestions.length > 0 ? (
          <div className="mt-4 grid gap-5">
            {enteredQuestions.map((question) => (
              <div
                key={question.id}
                className="rounded-md border border-slate-100 bg-slate-50/50 p-4"
              >
                <p className="text-xs font-medium text-slate-400">
                  第 {question.orderIndex} 题
                </p>
                <p className="mt-1 text-sm font-medium text-slate-800">
                  {question.questionText}
                </p>

                {question.answer ? (
                  <div className="mt-3 grid gap-3 border-t border-slate-200 pt-3">
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-slate-400">
                        回答用时：
                      </span>
                      <span className="text-xs font-medium text-slate-600">
                        {question.answer.durationSec != null
                          ? `${Math.round(question.answer.durationSec)} 秒`
                          : "未知"}
                      </span>
                    </div>

                    {question.answer.recording ? (
                      <div className="rounded-md border border-slate-200 bg-white p-3">
                        <p className="text-xs text-slate-400">回答录音</p>
                        <div className="mt-1">
                          <audio
                            controls
                            className="h-10 w-full"
                            src={question.answer.recording.playbackUrl}
                            preload="metadata"
                          />
                        </div>
                        {question.answer.recording.durationSec != null ? (
                          <p className="mt-1 text-xs text-slate-400">
                            时长：
                            {Math.round(question.answer.recording.durationSec)} 秒
                          </p>
                        ) : null}
                      </div>
                    ) : (
                      <p className="text-xs text-slate-400">未保存回答录音。</p>
                    )}

                    {question.answer.recording?.transcript ? (
                      <AbortQaTranscript
                        recording={question.answer.recording}
                        isExpanded={expandedTranscripts.has(
                          question.answer.recording.id,
                        )}
                        isTranscribing={qaTranscribingSet.has(
                          question.answer.recording.id,
                        )}
                        onToggleTranscriptExpand={onToggleTranscriptExpand}
                        onRetryQaTranscribe={onRetryQaTranscribe}
                      />
                    ) : (
                      <p className="text-xs text-slate-400">
                        暂未生成转写文本。
                      </p>
                    )}
                  </div>
                ) : null}
              </div>
            ))}
          </div>
        ) : (
          <p className="mt-4 rounded-md border border-dashed border-slate-200 p-4 text-sm text-slate-400">
            本轮训练尚未进入答辩，或未保存答辩回答。
          </p>
        )}
      </section>
    </div>
  );
}

function AbortQaTranscript({
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
