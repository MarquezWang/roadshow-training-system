import type { QaReview } from "./report-qa-types";

type ReportQaReviewBlockProps = Readonly<{
  qaReview: QaReview | undefined;
  suggestions: string[];
  questionOrderIndex: number;
}>;

export function ReportQaReviewBlock({
  qaReview,
  suggestions,
  questionOrderIndex,
}: ReportQaReviewBlockProps) {
  if (!qaReview) {
    return (
      <div className="mt-4 border-t border-slate-100 pt-4">
        {suggestions.length > 0 ? (
          <div className="rounded-md border border-slate-100 bg-slate-50/50 p-3">
            <p className="text-xs font-medium text-slate-500">回答建议</p>
            <p className="mt-1 text-xs text-slate-600">
              {suggestions[questionOrderIndex % suggestions.length]}
            </p>
          </div>
        ) : (
          <p className="text-xs text-slate-400">
            后续可结合评分结果补充本题回答建议。
          </p>
        )}
      </div>
    );
  }

  return (
    <div className="mt-4 space-y-3 border-t border-slate-100 pt-4">
      <p className="text-xs font-semibold text-slate-500">回答复盘</p>
      <div className="rounded border border-slate-100 bg-slate-50/50 px-3 py-2">
        <p className="text-xs text-slate-400">回答摘要</p>
        <p className="mt-0.5 text-xs leading-5 text-slate-700">
          {qaReview.answerSummary}
        </p>
      </div>
      <div className="rounded border border-slate-100 bg-slate-50/50 px-3 py-2">
        <p className="text-xs text-slate-400">证据使用情况</p>
        <p className="mt-0.5 text-xs leading-5 text-slate-700">
          {qaReview.evidenceUse}
        </p>
      </div>
      {qaReview.missingPoints.length > 0 ? (
        <div className="rounded border border-red-50 bg-red-50/30 px-3 py-2">
          <p className="text-xs font-medium text-red-600">缺失要点</p>
          <ul className="mt-1.5 space-y-1">
            {qaReview.missingPoints.map((point, idx) => (
              <li
                key={idx}
                className="flex gap-1.5 text-xs leading-5 text-red-700/80"
              >
                <span className="mt-1 h-1 w-1 shrink-0 rounded-full bg-red-400" />
                <span>{point}</span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      <div className="rounded border border-slate-100 bg-slate-50/50 px-3 py-2">
        <p className="text-xs text-slate-400">本题改进建议</p>
        <p className="mt-0.5 text-xs leading-5 text-slate-700">
          {qaReview.improvementAdvice}
        </p>
      </div>
      {qaReview.betterAnswerOutline.length > 0 ? (
        <div className="rounded border border-blue-50 bg-blue-50/30 px-3 py-2">
          <p className="text-xs font-medium text-blue-600">更优回答结构</p>
          <ul className="mt-1.5 space-y-1">
            {qaReview.betterAnswerOutline.map((outline, idx) => (
              <li
                key={idx}
                className="flex gap-1.5 text-xs leading-5 text-blue-700/80"
              >
                <span className="mt-1 h-1 w-1 shrink-0 rounded-full bg-blue-400" />
                <span>{outline}</span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
