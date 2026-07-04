import type {
  DynamicFollowupReview,
  QaQuestion,
  QaTranscript,
} from "./report-qa-types";

export function DynamicFollowupSection({
  question,
  review,
  qaTranscripts,
}: Readonly<{
  question: QaQuestion;
  review: DynamicFollowupReview | null;
  qaTranscripts: Record<string, QaTranscript | null | undefined>;
}>) {
  const recordingId = question.answer?.recording?.id ?? null;
  const transcriptText = recordingId
    ? qaTranscripts[recordingId]?.status === "COMPLETED"
      ? qaTranscripts[recordingId]?.text?.trim() ?? ""
      : ""
    : "";
  const answerText = question.answer?.answerText?.trim() || transcriptText;

  return (
    <section className="rounded-lg border border-cyan-100 bg-cyan-50/30 p-6">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="text-sm font-semibold text-slate-800">
          动态追问表现
        </h2>
        <span className="inline-flex rounded-full border border-cyan-200 bg-white px-2 py-0.5 text-xs font-medium text-cyan-700">
          Q{question.orderIndex}
        </span>
      </div>
      <p className="mt-1 text-xs text-slate-400">
        本模块仅展示动态追问表现，当前不计入总分。
      </p>

      <div className="mt-4 rounded-md border border-white/70 bg-white/80 p-4">
        <p className="text-xs font-medium text-cyan-700">动态追问问题</p>
        <p className="mt-2 text-sm font-medium leading-6 text-slate-800">
          {question.questionText}
        </p>
      </div>

      {answerText ? (
        <div className="mt-3 rounded-md border border-white/70 bg-white/80 p-4">
          <p className="text-xs font-medium text-cyan-700">用户回答</p>
          <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-slate-700">
            {answerText}
          </p>
        </div>
      ) : null}

      {review ? (
        <div className="mt-4 grid gap-3 md:grid-cols-2">
          <div className="rounded-md border border-white/70 bg-white/80 p-3">
            <p className="text-xs font-medium text-slate-500">回答摘要</p>
            <p className="mt-1 text-sm leading-6 text-slate-700">
              {review.answerSummary}
            </p>
          </div>
          <div className="rounded-md border border-white/70 bg-white/80 p-3">
            <p className="text-xs font-medium text-slate-500">
              追问针对的薄弱点
            </p>
            <p className="mt-1 text-sm leading-6 text-slate-700">
              {review.targetWeakness}
            </p>
          </div>
          <div className="rounded-md border border-white/70 bg-white/80 p-3">
            <p className="text-xs font-medium text-slate-500">
              关键证据补充情况
            </p>
            <p className="mt-1 text-sm leading-6 text-slate-700">
              {review.evidenceSupplement}
            </p>
          </div>
          <div className="rounded-md border border-white/70 bg-white/80 p-3">
            <p className="text-xs font-medium text-slate-500">改进建议</p>
            <p className="mt-1 text-sm leading-6 text-slate-700">
              {review.improvementAdvice}
            </p>
          </div>
        </div>
      ) : null}
    </section>
  );
}
