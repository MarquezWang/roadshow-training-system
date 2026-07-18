import type { QaGenerationPhase, QaGenerationQuestion } from "./types";

export const DYNAMIC_FOLLOWUP_RETRY_DELAY_MS = 3_000;
export const DYNAMIC_FOLLOWUP_MAX_RETRY_COUNT = 10;
export const QA_GENERATION_POLL_INTERVAL_MS = 3_000;
export const QA_GENERATION_WAIT_HINT_MS = 30_000;

export function getQaGenerationMaxWaitMs(dynamicFollowupExperiment: boolean) {
  return dynamicFollowupExperiment ? 120_000 : 60_000;
}

export function canAttemptDynamicFollowupPhase(phase: QaGenerationPhase) {
  return phase !== "DONE";
}

export function canScheduleDynamicFollowupRetry(
  phase: QaGenerationPhase,
  retryCount: number,
) {
  return (
    canAttemptDynamicFollowupPhase(phase) &&
    retryCount < DYNAMIC_FOLLOWUP_MAX_RETRY_COUNT
  );
}

export function isDynamicFollowupQuestion(
  question: QaGenerationQuestion | null,
) {
  return (
    question?.source === "DYNAMIC_FOLLOWUP" ||
    question?.questionType === "FOLLOWUP"
  );
}

export function isTranscriptNotReadyReason(reason: string | undefined) {
  if (!reason) {
    return false;
  }

  const normalizedReason = reason.trim().toLowerCase();

  return (
    normalizedReason === "dynamic_followup_in_progress" ||
    normalizedReason === "pitch_transcript_not_ready" ||
    normalizedReason === "transcript_not_ready" ||
    normalizedReason === "no_pitch_transcript" ||
    (normalizedReason.includes("transcript") &&
      (normalizedReason.includes("not_ready") ||
        normalizedReason.includes("not ready") ||
        normalizedReason.includes("missing")))
  );
}

export function getProtectedQuestionIds(questions: QaGenerationQuestion[]) {
  return questions
    .filter(
      (question) =>
        question.answer?.revealedQuestionText ||
        question.answer?.startedAt ||
        question.answer?.endedAt,
    )
    .map((question) => question.id);
}

export function appendDynamicFollowupQuestion(
  questions: QaGenerationQuestion[],
  createdQuestion: QaGenerationQuestion,
) {
  const hasDynamicQuestion = questions.some(
    (question) =>
      question.id === createdQuestion.id ||
      (question.orderIndex === createdQuestion.orderIndex &&
        question.source === "DYNAMIC_FOLLOWUP"),
  );

  if (hasDynamicQuestion) {
    return questions;
  }

  return [...questions, createdQuestion].sort(
    (first, second) => first.orderIndex - second.orderIndex,
  );
}
