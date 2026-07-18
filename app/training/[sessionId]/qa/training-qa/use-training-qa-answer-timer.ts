"use client";

import { useEffect } from "react";
import { isDynamicFollowupQuestion } from "./training-qa-flow";
import {
  DYNAMIC_FOLLOWUP_ANSWER_LIMIT_SEC,
  QA_LIMIT_SEC,
} from "./training-qa-timing";
import type { TrainingQaQuestion } from "./training-qa-types";
import type { TrainingQaState } from "./use-training-qa-state";

type UseTrainingQaAnswerTimerOptions = Pick<
  TrainingQaState,
  | "answerElapsedBeforePhaseRef"
  | "answerPhaseStartedMsRef"
  | "qaPhase"
  | "setDynamicFollowupUsedSec"
  | "setUsedAnswerSec"
> & {
  currentQuestion: TrainingQaQuestion | null;
  finishQaWithCurrentQuestion: (
    question: TrainingQaQuestion | null,
  ) => Promise<void>;
  isQaing: boolean;
  nextDynamicFollowupIndex: number;
  saveAndContinue: (options: {
    targetQuestionIndex: number;
    forceFinish: boolean;
  }) => Promise<void>;
};

export function useTrainingQaAnswerTimer({
  answerElapsedBeforePhaseRef,
  answerPhaseStartedMsRef,
  currentQuestion,
  finishQaWithCurrentQuestion,
  isQaing,
  nextDynamicFollowupIndex,
  qaPhase,
  saveAndContinue,
  setDynamicFollowupUsedSec,
  setUsedAnswerSec,
}: UseTrainingQaAnswerTimerOptions) {
  useEffect(() => {
    if (!isQaing || qaPhase !== "ANSWERING") {
      return;
    }

    const timer = window.setInterval(() => {
      let phaseStartedMs = answerPhaseStartedMsRef.current;

      if (phaseStartedMs === null) {
        phaseStartedMs = Date.now();
        answerPhaseStartedMsRef.current = phaseStartedMs;
      }

      const elapsedInPhase = Math.max(
        0,
        Math.floor((Date.now() - phaseStartedMs) / 1000),
      );

      if (isDynamicFollowupQuestion(currentQuestion)) {
        const nextUsedSec = Math.min(
          DYNAMIC_FOLLOWUP_ANSWER_LIMIT_SEC,
          elapsedInPhase,
        );

        setDynamicFollowupUsedSec(nextUsedSec);

        if (nextUsedSec >= DYNAMIC_FOLLOWUP_ANSWER_LIMIT_SEC) {
          window.clearInterval(timer);
          void finishQaWithCurrentQuestion(currentQuestion);
        }

        return;
      }

      const nextUsedSec = Math.min(
        QA_LIMIT_SEC,
        answerElapsedBeforePhaseRef.current + elapsedInPhase,
      );

      setUsedAnswerSec(nextUsedSec);

      if (nextUsedSec >= QA_LIMIT_SEC) {
        window.clearInterval(timer);
        if (nextDynamicFollowupIndex >= 0) {
          void saveAndContinue({
            targetQuestionIndex: nextDynamicFollowupIndex,
            forceFinish: false,
          });
        } else {
          void finishQaWithCurrentQuestion(currentQuestion);
        }
      }
    }, 500);

    return () => window.clearInterval(timer);
  }, [
    answerElapsedBeforePhaseRef,
    answerPhaseStartedMsRef,
    currentQuestion,
    finishQaWithCurrentQuestion,
    isQaing,
    nextDynamicFollowupIndex,
    qaPhase,
    saveAndContinue,
    setDynamicFollowupUsedSec,
    setUsedAnswerSec,
  ]);
}
