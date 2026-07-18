import Link from "next/link";
import { requireAdminUser } from "@/lib/auth-server";
import { PromptAssetsSection } from "./prompt-assets-section";
import {
  loadPromptChangelogPreview,
  loadPromptRows,
  loadPromptTestSuites,
} from "./prompt-data";
import { PromptFilterSection } from "./prompt-filter-section";
import {
  filterPrompts,
  normalizePromptFilters,
  summarizePrompts,
} from "./prompt-policy";
import { PromptSummarySection } from "./prompt-summary-section";
import { PromptSupportingSections } from "./prompt-supporting-sections";

export const dynamic = "force-dynamic";

type AdminPromptsPageProps = {
  searchParams?: Promise<{
    model?: string | string[];
    risk?: string | string[];
    status?: string | string[];
  }>;
};

export default async function AdminPromptsPage({
  searchParams,
}: AdminPromptsPageProps) {
  await requireAdminUser();

  const filters = normalizePromptFilters((await searchParams) ?? {});
  const [prompts, testSuites, changelogItems] = await Promise.all([
    loadPromptRows(),
    loadPromptTestSuites(),
    loadPromptChangelogPreview(),
  ]);
  const filteredPrompts = filterPrompts(prompts, filters);
  const summary = summarizePrompts(prompts);

  return (
    <main className="mx-auto w-full max-w-6xl flex-1 px-6 py-8 sm:px-8 lg:px-10">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <p className="text-sm text-slate-500">管理员工具</p>
          <h1 className="mt-1 text-2xl font-semibold text-slate-950">
            Prompt 管理
          </h1>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-600">
            只读查看当前 Prompt 资产、调用位置、模型档位、风险等级和测试样本。这里不提供在线编辑，避免误改线上 AI 行为。
          </p>
        </div>
        <Link
          href="/admin"
          className="rounded-md border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-700 transition hover:border-slate-300 hover:bg-slate-50"
        >
          返回
        </Link>
      </div>

      <PromptSummarySection summary={summary} />
      <PromptFilterSection filters={filters} />
      <PromptAssetsSection
        prompts={filteredPrompts}
        totalCount={summary.totalCount}
      />
      <PromptSupportingSections
        testSuites={testSuites}
        changelogItems={changelogItems}
      />
    </main>
  );
}
