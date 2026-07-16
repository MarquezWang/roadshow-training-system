import { isRecord } from "@/lib/type-guards";

export const evidenceStatuses = [
  "SUFFICIENT",
  "PARTIAL",
  "MISSING",
  "UNKNOWN",
] as const;

export const readinessLevels = [
  "HIGH",
  "MEDIUM",
  "LOW",
  "INSUFFICIENT",
] as const;

export type EvidenceStatus = (typeof evidenceStatuses)[number];
export type ReadinessLevel = (typeof readinessLevels)[number];

export type MaterialDiagnosisCriterion = {
  category: string;
  criterionName: string;
  weight: number;
  evidenceStatus: EvidenceStatus;
  evidenceSummary: string;
  issueSummary: string;
  improvementAdvice: string;
  likelyJudgeQuestions: string[];
};

export type MaterialDiagnosisPriorityTask = {
  title: string;
  reason: string;
  action: string;
  relatedCriteria: string[];
};

export type MaterialDiagnosisResult = {
  summary: string;
  readinessLevel: ReadinessLevel;
  readinessScore?: number;
  strengths: string[];
  weaknesses: string[];
  priorityTasks: MaterialDiagnosisPriorityTask[];
  judgeQuestions: string[];
  criteriaResults: MaterialDiagnosisCriterion[];
};

export type EvaluationCriterionForDiagnosis = {
  category: string | null;
  name: string;
  weight: number;
};

type RawMaterialDiagnosisCriterion = {
  category?: unknown;
  criterionName?: unknown;
  criterion?: unknown;
  weight?: unknown;
  maxScore?: unknown;
  evidenceStatus?: unknown;
  evidenceSummary?: unknown;
  issueSummary?: unknown;
  improvementAdvice?: unknown;
  likelyJudgeQuestions?: unknown;
};

type RawMaterialDiagnosisPriorityTask = {
  title?: unknown;
  reason?: unknown;
  action?: unknown;
  relatedCriteria?: unknown;
};

const evidenceScoreRatio: Record<EvidenceStatus, number> = {
  SUFFICIENT: 1,
  PARTIAL: 0.6,
  MISSING: 0.25,
  UNKNOWN: 0,
};

export const readinessLevelLabel: Record<ReadinessLevel, string> = {
  HIGH: "材料准备度高",
  MEDIUM: "材料准备度中等",
  LOW: "材料准备度偏低",
  INSUFFICIENT: "材料证据不足",
};

export const evidenceStatusLabel: Record<EvidenceStatus, string> = {
  SUFFICIENT: "证据充分",
  PARTIAL: "部分充分",
  MISSING: "证据不足",
  UNKNOWN: "无法判断",
};

function asString(value: unknown, fallback = "") {
  return typeof value === "string" ? value.trim() : fallback;
}

function asStringArray(value: unknown) {
  return Array.isArray(value)
    ? value
        .filter((item): item is string => typeof item === "string")
        .map((item) => item.trim())
        .filter(Boolean)
    : [];
}

function asEvidenceStatus(value: unknown): EvidenceStatus {
  if (
    typeof value === "string" &&
    evidenceStatuses.includes(value as EvidenceStatus)
  ) {
    return value as EvidenceStatus;
  }

  return "UNKNOWN";
}

function asPriorityTask(value: unknown): MaterialDiagnosisPriorityTask | null {
  if (!isRecord(value)) {
    return null;
  }

  const rawTask = value as RawMaterialDiagnosisPriorityTask;
  const title = asString(rawTask.title);
  const action = asString(rawTask.action);

  if (!title && !action) {
    return null;
  }

  return {
    title: title || "补充材料证据",
    reason: asString(rawTask.reason, "当前材料证据不足。"),
    action: action || "补充可核验的事实、数据、案例或证明材料。",
    relatedCriteria: asStringArray(rawTask.relatedCriteria),
  };
}

function isPriorityTask(
  value: MaterialDiagnosisPriorityTask | null,
): value is MaterialDiagnosisPriorityTask {
  return value !== null;
}

function getCriterionKey(criterion: EvaluationCriterionForDiagnosis) {
  return `${criterion.category ?? ""}::${criterion.name}`;
}

function normalizeCriterionResult(
  rawValue: unknown,
  criterion: EvaluationCriterionForDiagnosis,
): MaterialDiagnosisCriterion {
  const raw = isRecord(rawValue)
    ? (rawValue as RawMaterialDiagnosisCriterion)
    : {};
  const evidenceStatus = asEvidenceStatus(raw.evidenceStatus);

  return {
    category: criterion.category ?? "",
    criterionName: criterion.name,
    weight: criterion.weight,
    evidenceStatus,
    evidenceSummary:
      asString(raw.evidenceSummary) ||
      (evidenceStatus === "MISSING"
        ? "材料未提供足够证据。"
        : "材料证据需要进一步核验。"),
    issueSummary:
      asString(raw.issueSummary) ||
      (evidenceStatus === "SUFFICIENT"
        ? "暂无明显材料缺口。"
        : "该项材料证据不足或表达不够清晰。"),
    improvementAdvice:
      asString(raw.improvementAdvice) ||
      "补充可核验的事实、数据、案例或证明材料。",
    likelyJudgeQuestions: asStringArray(raw.likelyJudgeQuestions).slice(0, 3),
  };
}

function indexRawCriteriaResults(value: unknown) {
  const result = new Map<string, unknown>();

  if (!Array.isArray(value)) {
    return result;
  }

  for (const item of value) {
    if (!isRecord(item)) {
      continue;
    }

    const raw = item as RawMaterialDiagnosisCriterion;
    const category = asString(raw.category);
    const name = asString(raw.criterionName) || asString(raw.criterion);

    if (!name) {
      continue;
    }

    result.set(`${category}::${name}`, item);
    result.set(`::${name}`, item);
  }

  return result;
}

export function calculateReadinessScore(
  criteriaResults: MaterialDiagnosisCriterion[],
) {
  const totalWeight = criteriaResults.reduce(
    (total, item) => total + item.weight,
    0,
  );

  if (totalWeight <= 0) {
    return 0;
  }

  const weightedScore = criteriaResults.reduce(
    (total, item) =>
      total + item.weight * evidenceScoreRatio[item.evidenceStatus],
    0,
  );

  return Math.round((weightedScore / totalWeight) * 100);
}

export function deriveReadinessLevel(readinessScore: number): ReadinessLevel {
  if (readinessScore >= 80) {
    return "HIGH";
  }

  if (readinessScore >= 60) {
    return "MEDIUM";
  }

  if (readinessScore >= 40) {
    return "LOW";
  }

  return "INSUFFICIENT";
}

export function normalizeMaterialDiagnosisResult(
  value: unknown,
  criteria: EvaluationCriterionForDiagnosis[],
): MaterialDiagnosisResult {
  if (!isRecord(value)) {
    throw new Error("材料诊断 AI JSON 顶层结构必须是对象。");
  }

  if (criteria.length === 0) {
    throw new Error("当前评审规则没有诊断指标。");
  }

  const rawCriteriaByKey = indexRawCriteriaResults(value.criteriaResults);
  const criteriaResults = criteria.map((criterion) => {
    const rawCriterion =
      rawCriteriaByKey.get(getCriterionKey(criterion)) ??
      rawCriteriaByKey.get(`::${criterion.name}`);

    return normalizeCriterionResult(rawCriterion, criterion);
  });
  const readinessScore = calculateReadinessScore(criteriaResults);
  const readinessLevel = deriveReadinessLevel(readinessScore);
  const priorityTasks = Array.isArray(value.priorityTasks)
    ? value.priorityTasks.map(asPriorityTask).filter(isPriorityTask).slice(0, 5)
    : [];
  const judgeQuestions = [
    ...asStringArray(value.judgeQuestions),
    ...criteriaResults.flatMap((item) => item.likelyJudgeQuestions),
  ];

  return {
    summary:
      asString(value.summary) ||
      "系统已根据当前项目档案和材料文本生成赛前材料诊断。",
    readinessLevel,
    readinessScore,
    strengths: asStringArray(value.strengths).slice(0, 5),
    weaknesses: asStringArray(value.weaknesses).slice(0, 5),
    priorityTasks,
    judgeQuestions: [...new Set(judgeQuestions.filter(Boolean))].slice(0, 8),
    criteriaResults,
  };
}

export function parseStoredMaterialDiagnosis(value: {
  summary: string;
  readinessLevel: string;
  readinessScore: number | null;
  strengths: string;
  weaknesses: string;
  priorityTasks: string;
  judgeQuestions: string;
  criteriaResults: string;
}): MaterialDiagnosisResult {
  const readinessLevel = readinessLevels.includes(
    value.readinessLevel as ReadinessLevel,
  )
    ? (value.readinessLevel as ReadinessLevel)
    : "INSUFFICIENT";

  return {
    summary: value.summary,
    readinessLevel,
    readinessScore: value.readinessScore ?? undefined,
    strengths: JSON.parse(value.strengths) as string[],
    weaknesses: JSON.parse(value.weaknesses) as string[],
    priorityTasks: JSON.parse(
      value.priorityTasks,
    ) as MaterialDiagnosisPriorityTask[],
    judgeQuestions: JSON.parse(value.judgeQuestions) as string[],
    criteriaResults: JSON.parse(
      value.criteriaResults,
    ) as MaterialDiagnosisCriterion[],
  };
}
