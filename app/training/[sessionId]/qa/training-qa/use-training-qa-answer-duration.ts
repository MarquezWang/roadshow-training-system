"use client";

import { useCallback } from "react";
import { isDynamicFollowupQuestion } from "./training-qa-flow";
import {
  getCurrentUsedAnswerSec as calculateCurrentUsedAnswerSec,
  getSessionQaDurationSec as calculateSessionQaDurationSec,
} from "./training-qa-timing";
import type { TrainingQaQuestion } from "./training-qa-types";
import type { TrainingQaState } from "./use-training-qa-state";

type UseTrainingQaAnswerDurationOptions = Pick<
  TrainingQaState,
  | "answerElapsedBeforePhaseRef"
  | "answerPhaseStartedMsRef"
  | "dynamicFollowupUsedSec"
  | "qaPhase"
  | "usedAnswerSec"
> & {
  currentQuestion: TrainingQaQuestion | null;
};

export function useTrainingQaAnswerDuration({
  answerElapsedBeforePhaseRef,
  answerPhaseStartedMsRef,
  currentQuestion,
  dynamicFollowupUsedSec,
  qaPhase,
  usedAnswerSec,
}: UseTrainingQaAnswerDurationOptions) {
  const isCurrentDynamicFollowup =
    isDynamicFollowupQuestion(currentQuestion);
  const getCurrentUsedAnswerSec = useCallback(
    () =>
      calculateCurrentUsedAnswerSec({
        isDynamicFollowup: isCurrentDynamicFollowup,
        qaPhase,
        phaseStartedMs: answerPhaseStartedMsRef.current,
        elapsedBeforePhaseSec: answerElapsedBeforePhaseRef.current,
        usedAnswerSec,
        dynamicFollowupUsedSec,
        nowMs: Date.now(),
      }),
    [
      answerElapsedBeforePhaseRef,
      answerPhaseStartedMsRef,
      dynamicFollowupUsedSec,
      isCurrentDynamicFollowup,
      qaPhase,
      usedAnswerSec,
    ],
  );
  const getSessionQaDurationSec = useCallback(() => {
    const currentUsedSec = getCurrentUsedAnswerSec();

    return calculateSessionQaDurationSec(
      isCurrentDynamicFollowup,
      usedAnswerSec,
      currentUsedSec,
    );
  }, [getCurrentUsedAnswerSec, isCurrentDynamicFollowup, usedAnswerSec]);

  return {
    getCurrentUsedAnswerSec,
    getSessionQaDurationSec,
  };
}
