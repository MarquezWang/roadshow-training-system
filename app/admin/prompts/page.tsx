import { readdir, readFile, stat } from "fs/promises";
import Link from "next/link";
import path from "path";
import { requireAdminUser } from "@/lib/auth-server";

export const dynamic = "force-dynamic";

type PromptModel = "fast" | "strong" | "待确认";
type PromptRisk = "高" | "中" | "低" | "待确认";
type PromptStatus = "已接入" | "未接入";

type PromptAsset = {
  file: string;
  task: string;
  route: string;
  model: PromptModel;
  risk: PromptRisk;
  output: string;
  status: PromptStatus;
};

type PromptRow = PromptAsset & {
  size: number;
  updatedAt: Date;
};

type AdminPromptsPageProps = {
  searchParams?: Promise<{
    model?: string;
    risk?: string;
    status?: string;
  }>;
};

const PROMPTS_DIR = path.resolve(process.cwd(), "prompts");
const PROMPT_TESTS_DIR = path.resolve(process.cwd(), "prompt-tests");
const MANAGEMENT_FILES = new Set(["README.md", "registry.md", "changelog.md"]);

const promptAssets: Record<string, PromptAsset> = {
  "project-profile-recognition.md": {
    file: "project-profile-recognition.md",
    task: "新建项目基础档案识别",
    route: "app/api/projects/profile-recognition/route.ts",
    model: "strong",
    risk: "高",
    output: "项目名称、简介、领域、应用场景、关键词、产品形态",
    status: "已接入",
  },
  "project-trl-evidence-recognition.md": {
    file: "project-trl-evidence-recognition.md",
    task: "TRL 证据提取",
    route: "app/api/projects/profile-recognition/route.ts",
    model: "strong",
    risk: "高",
    output: "交付物类型、证据矩阵、缺失证据、置信度",
    status: "已接入",
  },
  "training-qa-question-generation.md": {
    file: "training-qa-question-generation.md",
    task: "训练流程评委问题生成",
    route: "app/training/[sessionId]/qa/questions/generate/route.ts",
    model: "strong",
    risk: "高",
    output: "Q1/Q2/Q3 评委问题",
    status: "已接入",
  },
  "dynamic-followup.md": {
    file: "dynamic-followup.md",
    task: "动态追问主 Prompt",
    route: "app/training/[sessionId]/qa/questions/dynamic-followup/route.ts",
    model: "strong",
    risk: "高",
    output: "一个追问或 NO_DYNAMIC_FOLLOWUP",
    status: "已接入",
  },
  "dynamic-followup-mismatch.md": {
    file: "dynamic-followup-mismatch.md",
    task: "动态追问兜底：上下文不匹配",
    route: "app/training/[sessionId]/qa/questions/dynamic-followup/route.ts",
    model: "strong",
    risk: "中",
    output: "一个追问或 NO_DYNAMIC_FOLLOWUP",
    status: "已接入",
  },
  "dynamic-followup-content.md": {
    file: "dynamic-followup-content.md",
    task: "动态追问兜底：内容充足",
    route: "app/training/[sessionId]/qa/questions/dynamic-followup/route.ts",
    model: "strong",
    risk: "中",
    output: "一个追问",
    status: "已接入",
  },
  "pitch-performance-analysis.md": {
    file: "pitch-performance-analysis.md",
    task: "训练报告 / 路演表现分析",
    route: "app/training/[sessionId]/analysis/route.ts",
    model: "strong",
    risk: "高",
    output: "评分、结论、优势、短板、改进建议",
    status: "已接入",
  },
  "question-generation.md": {
    file: "question-generation.md",
    task: "项目详情页模拟评委问题",
    route: "app/projects/[id]/questions/generate/route.ts",
    model: "strong",
    risk: "中",
    output: "模拟评委问题",
    status: "已接入",
  },
  "material-diagnosis.md": {
    file: "material-diagnosis.md",
    task: "材料诊断",
    route: "app/projects/[id]/diagnosis/route.ts",
    model: "strong",
    risk: "中",
    output: "材料问题、优化建议",
    status: "已接入",
  },
  "scoring.md": {
    file: "scoring.md",
    task: "评分辅助",
    route: "app/projects/[id]/scoring/route.ts",
    model: "strong",
    risk: "中",
    output: "评分维度或评分建议",
    status: "已接入",
  },
  "project-summary.md": {
    file: "project-summary.md",
    task: "AI 连通性测试 / 轻量摘要",
    route: "app/api/ai/test/route.ts",
    model: "fast",
    risk: "低",
    output: "轻量摘要或测试返回",
    status: "已接入",
  },
  "answer-feedback.md": {
    file: "answer-feedback.md",
    task: "答案反馈",
    route: "当前未发现调用",
    model: "待确认",
    risk: "低",
    output: "历史模板，后续确认是否清理",
    status: "未接入",
  },
  "final-report.md": {
    file: "final-report.md",
    task: "旧报告模板",
    route: "当前未发现调用",
    model: "待确认",
    risk: "低",
    output: "历史模板，后续确认是否清理",
    status: "未接入",
  },
};

const modelOptions = ["全部", "strong", "fast", "待确认"] as const;
const riskOptions = ["全部", "高", "中", "低", "待确认"] as const;
const statusOptions = ["全部", "已接入", "未接入"] as const;

function formatDate(value: Date) {
  return new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(value);
}

function formatBytes(bytes: number) {
  if (bytes < 1024) {
    return `${bytes} B`;
  }

  return `${(bytes / 1024).toFixed(1)} KB`;
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

function createFilterHref({
  model,
  risk,
  status,
}: {
  model: string;
  risk: string;
  status: string;
}) {
  const params = new URLSearchParams();

  if (model !== "全部") {
    params.set("model", model);
  }

  if (risk !== "全部") {
    params.set("risk", risk);
  }

  if (status !== "全部") {
    params.set("status", status);
  }

  const query = params.toString();
  return query ? `/admin/prompts?${query}` : "/admin/prompts";
}

function FilterGroup({
  label,
  options,
  active,
  current,
  param,
}: {
  label: string;
  options: readonly string[];
  active: string;
  current: {
    model: string;
    risk: string;
    status: string;
  };
  param: "model" | "risk" | "status";
}) {
  return (
    <div>
      <p className="text-xs font-medium text-slate-500">{label}</p>
      <div className="mt-2 flex flex-wrap gap-2">
        {options.map((option) => {
          const next = {
            ...current,
            [param]: option,
          };
          const isActive = option === active;

          return (
            <Link
              key={option}
              href={createFilterHref(next)}
              className={`rounded-full border px-3 py-1.5 text-xs font-medium transition ${
                isActive
                  ? "border-slate-950 bg-slate-950 text-white"
                  : "border-slate-200 bg-white text-slate-600 hover:border-slate-300"
              }`}
            >
              {option}
            </Link>
          );
        })}
      </div>
    </div>
  );
}

async function loadPromptRows() {
  const entries = await readdir(PROMPTS_DIR, { withFileTypes: true });
  const promptFiles = entries
    .filter(
      (entry) =>
        entry.isFile() &&
        entry.name.endsWith(".md") &&
        !MANAGEMENT_FILES.has(entry.name),
    )
    .map((entry) => entry.name)
    .sort((left, right) => left.localeCompare(right));

  return Promise.all(
    promptFiles.map(async (file) => {
      const filePath = path.join(PROMPTS_DIR, file);
      const fileStat = await stat(filePath);
      const asset = promptAssets[file] ?? {
        file,
        task: "未登记",
        route: "未登记",
        model: "待确认" as const,
        risk: "待确认" as const,
        output: "未登记",
        status: "未接入" as const,
      };

      return {
        ...asset,
        size: fileStat.size,
        updatedAt: fileStat.mtime,
      };
    }),
  );
}

async function loadTestSuites() {
  try {
    const entries = await readdir(PROMPT_TESTS_DIR, { withFileTypes: true });
    const directories = entries
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort((left, right) => left.localeCompare(right));

    return Promise.all(
      directories.map(async (directory) => {
        const suiteDir = path.join(PROMPT_TESTS_DIR, directory);
        const files = await readdir(suiteDir);
        return {
          name: directory,
          count: files.filter((file) => file.endsWith(".json")).length,
        };
      }),
    );
  } catch {
    return [];
  }
}

async function loadChangelogPreview() {
  try {
    const changelog = await readFile(
      path.join(PROMPTS_DIR, "changelog.md"),
      "utf8",
    );

    return changelog
      .split("\n")
      .filter((line) => line.startsWith("## "))
      .map((line) => line.replace(/^##\s+/, "").trim())
      .filter(
        (line) =>
          !line.includes("记录模板") &&
          !line.includes("YYYY-MM-DD") &&
          line !== "Prompt 变更记录",
      )
      .slice(0, 5);
  } catch {
    return [];
  }
}

function filterPrompts(
  prompts: PromptRow[],
  filters: { model: string; risk: string; status: string },
) {
  return prompts.filter((prompt) => {
    if (filters.model !== "全部" && prompt.model !== filters.model) {
      return false;
    }

    if (filters.risk !== "全部" && prompt.risk !== filters.risk) {
      return false;
    }

    if (filters.status !== "全部" && prompt.status !== filters.status) {
      return false;
    }

    return true;
  });
}

export default async function AdminPromptsPage({
  searchParams,
}: AdminPromptsPageProps) {
  await requireAdminUser();

  const params = (await searchParams) ?? {};
  const filters = {
    model: modelOptions.includes(params.model as (typeof modelOptions)[number])
      ? params.model ?? "全部"
      : "全部",
    risk: riskOptions.includes(params.risk as (typeof riskOptions)[number])
      ? params.risk ?? "全部"
      : "全部",
    status: statusOptions.includes(
      params.status as (typeof statusOptions)[number],
    )
      ? params.status ?? "全部"
      : "全部",
  };

  const [prompts, testSuites, changelogItems] = await Promise.all([
    loadPromptRows(),
    loadTestSuites(),
    loadChangelogPreview(),
  ]);
  const filteredPrompts = filterPrompts(prompts, filters);
  const strongCount = prompts.filter((prompt) => prompt.model === "strong").length;
  const highRiskCount = prompts.filter((prompt) => prompt.risk === "高").length;
  const integratedCount = prompts.filter(
    (prompt) => prompt.status === "已接入",
  ).length;

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

      <section className="mt-6 grid gap-4 md:grid-cols-4">
        <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
          <p className="text-sm text-slate-500">Prompt 文件</p>
          <p className="mt-2 text-3xl font-semibold text-slate-950">
            {prompts.length}
          </p>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
          <p className="text-sm text-slate-500">已接入</p>
          <p className="mt-2 text-3xl font-semibold text-teal-700">
            {integratedCount}
          </p>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
          <p className="text-sm text-slate-500">Strong 模型任务</p>
          <p className="mt-2 text-3xl font-semibold text-slate-950">
            {strongCount}
          </p>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
          <p className="text-sm text-slate-500">高风险 Prompt</p>
          <p className="mt-2 text-3xl font-semibold text-rose-600">
            {highRiskCount}
          </p>
        </div>
      </section>

      <section className="mt-6 rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="grid gap-5 lg:grid-cols-3">
          <FilterGroup
            label="模型档位"
            options={modelOptions}
            active={filters.model}
            current={filters}
            param="model"
          />
          <FilterGroup
            label="风险等级"
            options={riskOptions}
            active={filters.risk}
            current={filters}
            param="risk"
          />
          <FilterGroup
            label="接入状态"
            options={statusOptions}
            active={filters.status}
            current={filters}
            param="status"
          />
        </div>
      </section>

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
              当前显示 {filteredPrompts.length} / {prompts.length}
            </p>
          </div>
        </div>

        <div className="grid gap-3 p-5">
          {filteredPrompts.length > 0 ? (
            filteredPrompts.map((prompt) => (
              <article
                key={prompt.file}
                className="rounded-lg border border-slate-100 bg-slate-50/70 p-4"
              >
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
            ))
          ) : (
            <p className="rounded-lg border border-slate-100 bg-slate-50 px-4 py-8 text-center text-sm text-slate-500">
              当前筛选条件下没有 Prompt。
            </p>
          )}
        </div>
      </section>

      <section className="mt-6 grid gap-4 lg:grid-cols-2">
        <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
          <h2 className="text-base font-semibold text-slate-950">测试样本</h2>
          <div className="mt-4 grid gap-3">
            {testSuites.length > 0 ? (
              testSuites.map((suite) => (
                <div
                  key={suite.name}
                  className="flex items-center justify-between rounded-lg border border-slate-100 bg-slate-50 px-4 py-3"
                >
                  <span className="font-mono text-sm text-slate-700">
                    prompt-tests/{suite.name}
                  </span>
                  <span className="text-sm text-slate-500">
                    {suite.count} 个样本
                  </span>
                </div>
              ))
            ) : (
              <p className="text-sm text-slate-500">暂无测试样本。</p>
            )}
          </div>
        </div>

        <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
          <h2 className="text-base font-semibold text-slate-950">
            最近 Prompt 记录
          </h2>
          <div className="mt-4 grid gap-3">
            {changelogItems.length > 0 ? (
              changelogItems.map((item) => (
                <div
                  key={item}
                  className="rounded-lg border border-slate-100 bg-slate-50 px-4 py-3 text-sm text-slate-700"
                >
                  {item}
                </div>
              ))
            ) : (
              <p className="text-sm text-slate-500">暂无变更记录。</p>
            )}
          </div>
        </div>
      </section>
    </main>
  );
}
