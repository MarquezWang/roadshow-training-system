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

type ReportAbortOverviewTabProps = Readonly<{
  recording: AbortRecording | null;
  qaQuestions: AbortQaQuestion[];
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
          <p className="text-sm font-semibold text-amber-800">本轮训练已中止</p>
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
