import { formatBytes } from "./prompt-policy";
import type { PromptRisk, PromptRow, PromptStatus } from "./prompt-types";

function formatDate(value: Date) {
  return new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(value);
}

function getRiskClass(risk: PromptRisk) {
  switch (risk) {
    case "高":
      return "border-rose-200 bg-rose-50 text-rose-700";
    case "中":
      return "border-amber-200 bg-amber-50 text-amber-700";
    case "低":
      return "border-teal-200 bg-teal-50 text-teal-700";
    case "待确认":
      return "border-slate-200 bg-slate-50 text-slate-500";
  }
}

function getStatusClass(status: PromptStatus) {
  return status === "已接入"
    ? "border-teal-200 bg-teal-50 text-teal-700"
    : "border-slate-200 bg-slate-50 text-slate-500";
}

function PromptAssetCard({ prompt }: { prompt: PromptRow }) {
  return (
    <article className="rounded-lg border border-slate-100 bg-slate-50/70 p-4">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="font-mono text-sm font-semibold text-slate-950">
              {prompt.file}
            </h3>
            <span
              className={`rounded-full border px-2.5 py-1 text-xs font-medium ${getStatusClass(
                prompt.status,
              )}`}
            >
              {prompt.status}
            </span>
            <span className="rounded-full border border-slate-200 bg-white px-2.5 py-1 text-xs font-medium text-slate-700">
              {prompt.model}
            </span>
            <span
              className={`rounded-full border px-2.5 py-1 text-xs font-medium ${getRiskClass(
                prompt.risk,
              )}`}
            >
              {prompt.risk}
            </span>
          </div>
          <p className="mt-2 text-sm font-medium text-slate-800">
            {prompt.task}
          </p>
          <p className="mt-1 text-sm leading-6 text-slate-600">
            {prompt.output}
          </p>
        </div>
        <div className="shrink-0 text-left text-xs text-slate-500 lg:text-right">
          <p>{formatBytes(prompt.size)}</p>
          <p className="mt-1">{formatDate(prompt.updatedAt)}</p>
        </div>
      </div>
      <div className="mt-3 rounded-md border border-slate-100 bg-white px-3 py-2 font-mono text-xs leading-5 text-slate-500">
        {prompt.route}
      </div>
    </article>
  );
}

export function PromptAssetsSection({
  prompts,
  totalCount,
}: {
  prompts: PromptRow[];
  totalCount: number;
}) {
  return (
    <section className="mt-6 rounded-xl border border-slate-200 bg-white shadow-sm">
      <div className="border-b border-slate-100 px-5 py-4">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h2 className="text-base font-semibold text-slate-950">
              Prompt 资产清单
            </h2>
            <p className="mt-1 text-sm text-slate-500">
              修改 Prompt 前，先确认任务、风险和对应回归样本。
            </p>
          </div>
          <p className="text-sm text-slate-500">
            当前显示 {prompts.length} / {totalCount}
          </p>
        </div>
      </div>

      <div className="grid gap-3 p-5">
        {prompts.length > 0 ? (
          prompts.map((prompt) => (
            <PromptAssetCard key={prompt.file} prompt={prompt} />
          ))
        ) : (
          <p className="rounded-lg border border-slate-100 bg-slate-50 px-4 py-8 text-center text-sm text-slate-500">
            当前筛选条件下没有 Prompt。
          </p>
        )}
      </div>
    </section>
  );
}
