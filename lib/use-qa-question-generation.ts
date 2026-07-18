"use client";

import { useBaseQaQuestionGeneration } from "./qa-question-generation/use-base-qa-question-generation";
import { useDynamicFollowupQuestion } from "./qa-question-generation/use-dynamic-followup-question";
import type { UseQaQuestionGenerationOptions } from "./qa-question-generation/types";

export type { QaGenerationQuestion } from "./qa-question-generation/types";

export function useQaQuestionGeneration({
  sessionId,
  dynamicFollowupExperiment,
  isGuardResolved,
  qaPhase,
  questions,
  setQuestions,
  setCurrentQuestionIndex,
  setMessage,
}: UseQaQuestionGenerationOptions) {
  useDynamicFollowupQuestion({
    sessionId,
    dynamicFollowupExperiment,
    isGuardResolved,
    qaPhase,
    questions,
    setQuestions,
  });

  return useBaseQaQuestionGeneration({
    sessionId,
    dynamicFollowupExperiment,
    isGuardResolved,
    questions,
    setQuestions,
    setCurrentQuestionIndex,
    setMessage,
  });
}
