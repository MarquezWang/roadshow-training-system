import { isRecord } from "@/lib/type-guards";
import {
  EVIDENCE_SCORE_RATIO,
  type ReadinessLevel,
} from "./constants";
import {
  asEvidenceStatus,
  asString,
  asStringArray,
} from "./primitives";
import type {
  EvaluationCriterionForDiagnosis,
  MaterialDiagnosisCriterion,
  RawMaterialDiagnosisCriterion,
} from "./types";

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

export function normalizeCriteriaResults(
  value: unknown,
  criteria: EvaluationCriterionForDiagnosis[],
) {
  const rawCriteriaByKey = indexRawCriteriaResults(value);
  return criteria.map((criterion) => {
    const rawCriterion =
      rawCriteriaByKey.get(getCriterionKey(criterion)) ??
      rawCriteriaByKey.get(`::${criterion.name}`);
    return normalizeCriterionResult(rawCriterion, criterion);
  });
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
      total + item.weight * EVIDENCE_SCORE_RATIO[item.evidenceStatus],
    0,
  );
  return Math.round((weightedScore / totalWeight) * 100);
}

export function deriveReadinessLevel(readinessScore: number): ReadinessLevel {
  if (readinessScore >= 80) return "HIGH";
  if (readinessScore >= 60) return "MEDIUM";
  if (readinessScore >= 40) return "LOW";
  return "INSUFFICIENT";
}
