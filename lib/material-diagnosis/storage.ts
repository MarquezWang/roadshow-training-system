import {
  LEGACY_DIAGNOSIS_SCHEMA_VERSION,
  MATERIAL_DIAGNOSIS_LEGACY_SCHEMA_VERSION,
  MATERIAL_DIAGNOSIS_SCHEMA_VERSION,
  readinessLevels,
  type ReadinessLevel,
} from "./constants";
import type {
  MaterialDiagnosisCriterion,
  MaterialDiagnosisPriorityTask,
  MaterialDiagnosisResult,
} from "./types";

type StoredMaterialDiagnosis = {
  summary: string;
  readinessLevel: string;
  readinessScore: number | null;
  strengths: string;
  weaknesses: string;
  priorityTasks: string;
  judgeQuestions: string;
  criteriaResults: string;
  schemaVersion?: string;
  rawResultJson?: string;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function readString(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function readStringArray(value: unknown) {
  if (!Array.isArray(value)) return [];
  return value.map(readString).filter(Boolean);
}

function parseJson(value: string): unknown {
  return JSON.parse(value) as unknown;
}

function parseJsonArray<T>(value: string, fieldName: string): T[] {
  const parsed = parseJson(value);
  if (!Array.isArray(parsed)) {
    throw new Error(`材料诊断字段 ${fieldName} 必须是 JSON 数组。`);
  }
  return parsed as T[];
}

function parseNestedJson(value: unknown, fallback: unknown) {
  if (typeof value !== "string") return fallback;
  try {
    return parseJson(value);
  } catch {
    return fallback;
  }
}

function parseLegacyDiagnosis(
  value: StoredMaterialDiagnosis,
): MaterialDiagnosisResult {
  const rawValue = value.rawResultJson
    ? parseNestedJson(value.rawResultJson, {})
    : {};
  if (!isRecord(rawValue)) {
    throw new Error("旧版材料诊断原始载荷必须是 JSON 对象。");
  }

  const issuesValue = parseNestedJson(rawValue.issuesJson, {});
  const risksValue = parseNestedJson(rawValue.risksJson, []);
  const suggestionsValue = parseNestedJson(rawValue.suggestionsJson, {});
  const issues = isRecord(issuesValue) ? issuesValue : {};
  const suggestions = isRecord(suggestionsValue) ? suggestionsValue : {};
  const criterionAnalysis = Array.isArray(issues.criterionAnalysis)
    ? issues.criterionAnalysis
    : [];
  const criteriaResults: MaterialDiagnosisCriterion[] = criterionAnalysis
    .filter(isRecord)
    .map((criterion) => {
      const problems = readStringArray(criterion.problems);
      const advice = readStringArray(criterion.suggestions);
      const weight = Number(criterion.maxScore);

      return {
        category: readString(criterion.category),
        criterionName:
          readString(criterion.criterion) || "旧版未命名评审指标",
        weight: Number.isFinite(weight) ? weight : 0,
        evidenceStatus: "UNKNOWN",
        evidenceSummary:
          readString(criterion.materialStatus) || "旧版诊断未记录证据状态。",
        issueSummary: problems.join("；") || "旧版诊断未记录材料缺口。",
        improvementAdvice:
          advice.join("；") || "请按当前评审规则重新生成材料诊断。",
        likelyJudgeQuestions: [],
      };
    });
  const weaknesses = [
    ...readStringArray(issues.keyIssues),
    ...readStringArray(risksValue),
  ];
  const migratedTasks: MaterialDiagnosisPriorityTask[] = [
    ...readStringArray(suggestions.priorityActions).map((action) => ({
      title: action,
      reason: "由旧版材料诊断迁移。",
      action,
      relatedCriteria: [],
    })),
    ...readStringArray(suggestions.slideSuggestions).map((action) => ({
      title: "优化路演材料",
      reason: "由旧版材料诊断迁移。",
      action,
      relatedCriteria: [],
    })),
    ...readStringArray(suggestions.pitchSuggestions).map((action) => ({
      title: "优化路演表达",
      reason: "由旧版材料诊断迁移。",
      action,
      relatedCriteria: [],
    })),
  ].slice(0, 5);
  const projectSummary = readString(rawValue.projectSummary) || value.summary;
  const completeness = readString(rawValue.materialCompleteness);

  return {
    summary: completeness
      ? `${projectSummary}\n材料完整性：${completeness}`
      : projectSummary,
    readinessLevel: "INSUFFICIENT",
    readinessScore: undefined,
    strengths: [],
    weaknesses: [...new Set(weaknesses)].slice(0, 8),
    priorityTasks: migratedTasks,
    judgeQuestions: [],
    criteriaResults,
  };
}

export function parseStoredMaterialDiagnosis(
  value: StoredMaterialDiagnosis,
): MaterialDiagnosisResult {
  const schemaVersion = value.schemaVersion?.trim() || "legacy-unknown";
  if (schemaVersion === LEGACY_DIAGNOSIS_SCHEMA_VERSION) {
    return parseLegacyDiagnosis(value);
  }
  if (
    schemaVersion !== "legacy-unknown" &&
    schemaVersion !== MATERIAL_DIAGNOSIS_LEGACY_SCHEMA_VERSION &&
    schemaVersion !== MATERIAL_DIAGNOSIS_SCHEMA_VERSION
  ) {
    throw new Error(`不支持的材料诊断 schemaVersion：${schemaVersion}`);
  }

  const readinessLevel = readinessLevels.includes(
    value.readinessLevel as ReadinessLevel,
  )
    ? (value.readinessLevel as ReadinessLevel)
    : "INSUFFICIENT";

  return {
    summary: value.summary,
    readinessLevel,
    readinessScore: value.readinessScore ?? undefined,
    strengths: parseJsonArray<string>(value.strengths, "strengths"),
    weaknesses: parseJsonArray<string>(value.weaknesses, "weaknesses"),
    priorityTasks: parseJsonArray<MaterialDiagnosisPriorityTask>(
      value.priorityTasks,
      "priorityTasks",
    ),
    judgeQuestions: parseJsonArray<string>(
      value.judgeQuestions,
      "judgeQuestions",
    ),
    criteriaResults: parseJsonArray<MaterialDiagnosisCriterion>(
      value.criteriaResults,
      "criteriaResults",
    ),
  };
}
