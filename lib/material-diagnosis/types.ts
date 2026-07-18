import type {
  EvidenceStatus,
  ReadinessLevel,
} from "./constants";

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

export type RawMaterialDiagnosisCriterion = {
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

export type RawMaterialDiagnosisPriorityTask = {
  title?: unknown;
  reason?: unknown;
  action?: unknown;
  relatedCriteria?: unknown;
};
