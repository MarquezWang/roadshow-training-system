import { isRecord } from "@/lib/type-guards";
import {
  calculateReadinessScore,
  deriveReadinessLevel,
  normalizeCriteriaResults,
} from "./criteria";
import { asString, asStringArray } from "./primitives";
import { normalizePriorityTasks } from "./priority-tasks";
import type {
  EvaluationCriterionForDiagnosis,
  MaterialDiagnosisResult,
} from "./types";

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

  const criteriaResults = normalizeCriteriaResults(
    value.criteriaResults,
    criteria,
  );
  const readinessScore = calculateReadinessScore(criteriaResults);
  const readinessLevel = deriveReadinessLevel(readinessScore);
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
    priorityTasks: normalizePriorityTasks(value.priorityTasks),
    judgeQuestions: [...new Set(judgeQuestions.filter(Boolean))].slice(0, 8),
    criteriaResults,
  };
}
