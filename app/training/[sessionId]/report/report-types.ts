import type { DynamicFollowupReview } from "./report-qa-types";

export type TrainingTranscript = {
  id: string;
  recordingId: string;
  sessionId: string;
  status: string;
  source: string;
  language: string;
  text: string;
  segmentsJson: string | null;
  errorMessage: string | null;
  startedAt: string | null;
  completedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type TrainingRecording = {
  id: string;
  phase: string;
  playbackUrl: string;
  mimeType: string;
  sizeBytes: number;
  durationSec: number | null;
  transcript: TrainingTranscript | null;
};

export type TrainingQaQuestion = {
  id: string;
  orderIndex: number;
  questionText: string;
  questionType: string | null;
  source: string;
  basis: string | null;
  answer: {
    id: string;
    answerText: string | null;
    revealedQuestionText: boolean;
    startedAt: string | null;
    endedAt: string | null;
    durationSec: number | null;
    recording: TrainingRecording | null;
  } | null;
};

export function isDynamicFollowupQuestion(question: TrainingQaQuestion) {
  return (
    question.source === "DYNAMIC_FOLLOWUP" ||
    question.questionType === "FOLLOWUP"
  );
}

export function hasEnteredQaQuestion(question: TrainingQaQuestion) {
  return Boolean(
    question.answer?.startedAt ||
      question.answer?.endedAt ||
      question.answer?.recording ||
      question.answer?.answerText?.trim(),
  );
}

export type ReportTrainingAnalysis = {
  id: string;
  status: string;
  overallScore: number | null;
  isFallbackReport: boolean;
  summary: string;
  errorMessage: string | null;
  updatedAt: string;
  strengths: string[];
  weaknesses: string[];
  suggestions: string[];
  onePageSummary: {
    conclusion: string;
    strongestPoint: string;
    biggestWeakness: string;
    nextTrainingFocus: string;
    readinessAdvice: string;
  } | null;
  diagnostics: {
    content: string[];
    delivery: string[];
    qa: string[];
  } | null;
  actionItems: Array<{
    issue: string;
    whyItMatters: string;
    howToFix: string;
    sampleWording: string;
  }>;
  nextTrainingTasks: string[];
  contentCoverage: Array<{
    item: string;
    covered: string;
    evidence: string;
    suggestion: string;
  }>;
  timing: Record<string, unknown>;
  slideSync: Record<string, unknown>;
  riskQuestions: string[];
  qaReviews: Array<{
    questionId: string;
    questionIndex: number;
    dimension: string;
    question: string;
    judgeIntent: string;
    answerSummary: string;
    responseQuality: string;
    responseQualityLabel: string;
    missingPoints: string[];
    evidenceUse: string;
    improvementAdvice: string;
    betterAnswerOutline: string[];
  }>;
  dynamicFollowupReview: DynamicFollowupReview | null;
};
