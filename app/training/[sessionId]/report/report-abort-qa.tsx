import { AbortQaTranscript } from "./report-abort-qa-transcript";
import type { AbortRecording } from "./report-abort";

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
