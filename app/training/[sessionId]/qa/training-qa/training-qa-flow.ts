import type { TrainingQaQuestion } from "./training-qa-types";

export function findInitialQaQuestionIndex(questions: TrainingQaQuestion[]) {
  const activeIndex = questions.findIndex(
    (question) => !question.answer?.endedAt,
  );

  return activeIndex >= 0 ? activeIndex : Math.max(0, questions.length - 1);
}

export function isDynamicFollowupQuestion(question: TrainingQaQuestion | null) {
  return (
    question?.source === "DYNAMIC_FOLLOWUP" ||
    question?.questionType === "FOLLOWUP"
  );
}

export function getQaProgression(
  questions: TrainingQaQuestion[],
  currentQuestionIndex: number,
  remainingSec: number,
) {
  const currentQuestion = questions[currentQuestionIndex] ?? null;
  const isCurrentDynamicFollowup = isDynamicFollowupQuestion(currentQuestion);
  const isLastQuestion = currentQuestionIndex >= questions.length - 1;
  const nextDynamicFollowupIndex = questions.findIndex(
    (question, index) =>
      index > currentQuestionIndex &&
      isDynamicFollowupQuestion(question) &&
      !question.answer?.endedAt,
  );
  const shouldSkipToDynamicFollowup =
    !isCurrentDynamicFollowup &&
    remainingSec <= 30 &&
    nextDynamicFollowupIndex >= 0;
  const hasNextBaseQuestion = questions
    .slice(currentQuestionIndex + 1)
    .some((question) => !isDynamicFollowupQuestion(question));

  return {
    isCurrentDynamicFollowup,
    nextDynamicFollowupIndex,
    shouldSkipToDynamicFollowup,
    shouldFinishAfterCurrent:
      isCurrentDynamicFollowup ||
      isLastQuestion ||
      (!shouldSkipToDynamicFollowup &&
        remainingSec <= 30 &&
        hasNextBaseQuestion),
  };
}
