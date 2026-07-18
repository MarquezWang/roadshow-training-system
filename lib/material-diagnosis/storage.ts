import {
  readinessLevels,
  type ReadinessLevel,
} from "./constants";
import type {
  MaterialDiagnosisCriterion,
  MaterialDiagnosisPriorityTask,
  MaterialDiagnosisResult,
} from "./types";

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
