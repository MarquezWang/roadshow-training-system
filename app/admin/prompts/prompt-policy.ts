import type { PromptRow } from "./prompt-types";

export const modelOptions = ["全部", "strong", "fast", "待确认"] as const;
export const riskOptions = ["全部", "高", "中", "低", "待确认"] as const;
export const statusOptions = ["全部", "已接入", "未接入"] as const;

export type PromptFilters = {
  model: (typeof modelOptions)[number];
  risk: (typeof riskOptions)[number];
  status: (typeof statusOptions)[number];
};

type PromptSearchParams = {
  model?: string | string[];
  risk?: string | string[];
  status?: string | string[];
};

export type PromptSummary = {
  totalCount: number;
  integratedCount: number;
  strongCount: number;
  highRiskCount: number;
};

function normalizeOption<const T extends readonly string[]>(
  value: string | string[] | undefined,
  options: T,
): T[number] {
  return typeof value === "string" && options.includes(value)
    ? (value as T[number])
    : options[0];
}

export function normalizePromptFilters(
  params: PromptSearchParams,
): PromptFilters {
  return {
    model: normalizeOption(params.model, modelOptions),
    risk: normalizeOption(params.risk, riskOptions),
    status: normalizeOption(params.status, statusOptions),
  };
}

export function createFilterHref(filters: PromptFilters) {
  const params = new URLSearchParams();

  if (filters.model !== "全部") {
    params.set("model", filters.model);
  }

  if (filters.risk !== "全部") {
    params.set("risk", filters.risk);
  }

  if (filters.status !== "全部") {
    params.set("status", filters.status);
  }

  const query = params.toString();
  return query ? `/admin/prompts?${query}` : "/admin/prompts";
}

export function filterPrompts(
  prompts: PromptRow[],
  filters: PromptFilters,
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

export function summarizePrompts(prompts: PromptRow[]): PromptSummary {
  return prompts.reduce<PromptSummary>(
    (summary, prompt) => ({
      totalCount: summary.totalCount + 1,
      integratedCount:
        summary.integratedCount + (prompt.status === "已接入" ? 1 : 0),
      strongCount: summary.strongCount + (prompt.model === "strong" ? 1 : 0),
      highRiskCount: summary.highRiskCount + (prompt.risk === "高" ? 1 : 0),
    }),
    {
      totalCount: 0,
      integratedCount: 0,
      strongCount: 0,
      highRiskCount: 0,
    },
  );
}

export function formatBytes(bytes: number) {
  if (bytes < 1024) {
    return `${bytes} B`;
  }

  return `${(bytes / 1024).toFixed(1)} KB`;
}

export function getChangelogItems(changelog: string) {
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
}
