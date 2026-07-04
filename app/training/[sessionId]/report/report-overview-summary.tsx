"use client";

type OverviewAnalysis = {
  overallScore: number | null;
  summary: string;
};

type OnePageSummary = {
  conclusion: string;
  strongestPoint: string;
  biggestWeakness: string;
  nextTrainingFocus: string;
  readinessAdvice: string;
};

type ReportOverviewSummaryProps = Readonly<{
  analysis: OverviewAnalysis;
  onePageSummary: OnePageSummary;
  copySummaryMessage: string;
  onCopyOnePageSummary: () => void;
}>;

export function ReportOverviewSummary({
  analysis,
  onePageSummary,
  copySummaryMessage,
  onCopyOnePageSummary,
}: ReportOverviewSummaryProps) {
  return (
    <section className="rounded-lg border border-slate-100 bg-white p-6">
      <div className="flex flex-col gap-4 border-b border-slate-100 pb-5 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <p className="text-xs font-medium uppercase tracking-wide text-slate-400">
            一页式复盘
          </p>
          <h2 className="mt-2 text-lg font-semibold text-slate-950">
            本次训练结论
          </h2>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-600">
            {onePageSummary.conclusion || analysis.summary}
          </p>
        </div>
        <div className="flex shrink-0 flex-col items-start gap-3 sm:flex-row lg:flex-col lg:items-end">
          <button
            type="button"
            onClick={onCopyOnePageSummary}
            className="inline-flex h-9 items-center justify-center rounded-md border border-slate-200 bg-white px-3 text-xs font-medium text-slate-700 transition-colors hover:bg-slate-50"
          >
            复制复盘摘要
          </button>
          <div className="rounded-xl border border-slate-200 bg-slate-50 px-5 py-4 text-center">
            <p className="text-xs font-medium text-slate-500">综合评分</p>
            <p className="mt-1 text-4xl font-semibold text-slate-950">
              {analysis.overallScore ?? "-"}
            </p>
            <p className="text-xs text-slate-400">/ 100</p>
          </div>
          {copySummaryMessage ? (
            <p className="text-xs text-teal-700">{copySummaryMessage}</p>
          ) : null}
        </div>
      </div>

      <div className="mt-5 grid gap-4 lg:grid-cols-4">
        <div className="rounded-xl border border-emerald-100 bg-emerald-50/70 p-4">
          <p className="text-xs font-semibold text-emerald-700">最大优势</p>
          <p className="mt-2 text-sm leading-6 text-emerald-950/80">
            {onePageSummary.strongestPoint}
          </p>
        </div>
        <div className="rounded-xl border border-amber-100 bg-amber-50/80 p-4">
          <p className="text-xs font-semibold text-amber-700">最大短板</p>
          <p className="mt-2 text-sm leading-6 text-amber-950/80">
            {onePageSummary.biggestWeakness}
          </p>
        </div>
        <div className="rounded-xl border border-blue-100 bg-blue-50/80 p-4">
          <p className="text-xs font-semibold text-blue-700">下一轮重点</p>
          <p className="mt-2 text-sm leading-6 text-blue-950/80">
            {onePageSummary.nextTrainingFocus}
          </p>
        </div>
        <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
          <p className="text-xs font-semibold text-slate-500">正式展示建议</p>
          <p className="mt-2 text-sm leading-6 text-slate-700">
            {onePageSummary.readinessAdvice}
          </p>
        </div>
      </div>
    </section>
  );
}
