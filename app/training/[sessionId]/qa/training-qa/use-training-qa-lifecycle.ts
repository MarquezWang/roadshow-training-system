"use client";

import { useEffect } from "react";
import type { TrainingQaState } from "./use-training-qa-state";

type UseTrainingQaLifecycleOptions = Pick<
  TrainingQaState,
  "hasResumedQaingRef"
> & {
  beginJudgeQuestion: (questionIndex: number) => void;
  cancelSpeech: () => void;
  cleanupRecording: () => void;
  clearCountdownTimer: () => void;
  clearDynamicFollowupIntroTimer: () => void;
  clearSpeechTimer: () => void;
  initialQuestionIndex: number;
  initialStatus: string;
  isGuardResolved: boolean;
  questionCount: number;
};

export function useTrainingQaLifecycle({
  beginJudgeQuestion,
  cancelSpeech,
  cleanupRecording,
  clearCountdownTimer,
  clearDynamicFollowupIntroTimer,
  clearSpeechTimer,
  hasResumedQaingRef,
  initialQuestionIndex,
  initialStatus,
  isGuardResolved,
  questionCount,
}: UseTrainingQaLifecycleOptions) {
  useEffect(() => {
    if (
      initialStatus !== "QAING" ||
      !isGuardResolved ||
      hasResumedQaingRef.current ||
      questionCount === 0
    ) {
      return;
    }

    hasResumedQaingRef.current = true;
    beginJudgeQuestion(initialQuestionIndex);
  }, [
    beginJudgeQuestion,
    hasResumedQaingRef,
    initialQuestionIndex,
    initialStatus,
    isGuardResolved,
    questionCount,
  ]);

  useEffect(() => {
    return () => {
      clearDynamicFollowupIntroTimer();
      clearSpeechTimer();
      clearCountdownTimer();
      cancelSpeech();
      cleanupRecording();
    };
  }, [
    cancelSpeech,
    cleanupRecording,
    clearCountdownTimer,
    clearDynamicFollowupIntroTimer,
    clearSpeechTimer,
  ]);
}
