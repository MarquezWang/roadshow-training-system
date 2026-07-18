export type QaReview = {
  questionId: string;
  questionIndex: number;
  dimension: "TECHNICAL" | "MARKET" | "RISK" | "FINANCE" | "TEAM" | "OTHER";
  question: string;
  judgeIntent: string;
  answerSummary: string;
  responseQuality: "GOOD" | "PARTIAL" | "WEAK";
  responseQualityLabel: string;
  missingPoints: string[];
  evidenceUse: string;
  improvementAdvice: string;
  betterAnswerOutline: string[];
};

export type DynamicFollowupReview = {
  questionId: string;
  question: string;
  answerSummary: string;
  targetWeakness: string;
  evidenceSupplement: string;
  improvementAdvice: string;
};

export type ReportOnePageSummary = {
  conclusion: string;
  strongestPoint: string;
  biggestWeakness: string;
  nextTrainingFocus: string;
  readinessAdvice: string;
};

export type ReportDiagnostics = {
  content: string[];
  delivery: string[];
  qa: string[];
};

export type ReportActionItem = {
  issue: string;
  whyItMatters: string;
  howToFix: string;
  sampleWording: string;
};

export type TrainingAnalysisResult = {
  overallScore: number;
  summary: string;
  strengths: string[];
  weaknesses: string[];
  suggestions: string[];
  onePageSummary?: ReportOnePageSummary;
  diagnostics?: ReportDiagnostics;
  actionItems?: ReportActionItem[];
  nextTrainingTasks?: string[];
  contentCoverage: Array<{
    item: string;
    covered: "true" | "false" | "partial" | "INSUFFICIENT";
    evidence: string;
    suggestion: string;
  }>;
  timing: Record<string, unknown> & {
    durationSec?: number;
    targetDurationSec?: number;
    assessment?: string;
    opening?: string;
    middle?: string;
    ending?: string;
    suggestion?: string;
  };
  slideSync: Record<string, unknown> & {
    slideEventCount?: number;
    pageCount?: number;
    assessment?: string;
    frequentFlipRisk?: string;
    longStayRisk?: string;
    suggestion?: string;
  };
  riskQuestions: string[];
  qaReviews?: QaReview[];
  dynamicFollowupReview?: DynamicFollowupReview | null;
};
