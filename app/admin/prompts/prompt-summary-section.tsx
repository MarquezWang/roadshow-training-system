import type { PromptSummary } from "./prompt-policy";

export function PromptSummarySection({ summary }: { summary: PromptSummary }) {
  return (
    <section className="mt-6 grid gap-4 md:grid-cols-4">
      <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
        <p className="text-sm text-slate-500">Prompt 文件</p>
        <p className="mt-2 text-3xl font-semibold text-slate-950">
          {summary.totalCount}
        </p>
      </div>
      <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
        <p className="text-sm text-slate-500">已接入</p>
        <p className="mt-2 text-3xl font-semibold text-teal-700">
          {summary.integratedCount}
        </p>
      </div>
      <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
        <p className="text-sm text-slate-500">Strong 模型任务</p>
        <p className="mt-2 text-3xl font-semibold text-slate-950">
          {summary.strongCount}
        </p>
      </div>
      <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
        <p className="text-sm text-slate-500">高风险 Prompt</p>
        <p className="mt-2 text-3xl font-semibold text-rose-600">
          {summary.highRiskCount}
        </p>
      </div>
    </section>
  );
}
