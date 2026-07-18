"use client";

import { useCallback, useEffect } from "react";
import type { TrainingQaState } from "./use-training-qa-state";

type UseTrainingQaCountdownOptions = Pick<
  TrainingQaState,
  | "answerElapsedBeforePhaseRef"
  | "answerPhaseStartedMsRef"
  | "beginPreAnswerCountdownRef"
  | "countdownIntervalRef"
  | "currentAnswerStartedAtRef"
  | "setDynamicFollowupUsedSec"
  | "setPreAnswerOverlay"
  | "setQaPhase"
  | "setUsedAnswerSec"
  | "usedAnswerSec"
> & {
  cancelSpeech: () => void;
  clearSpeechTimer: () => void;
  startQuestionRecording: () => Promise<void>;
};

export function useTrainingQaCountdown({
  answerElapsedBeforePhaseRef,
  answerPhaseStartedMsRef,
  beginPreAnswerCountdownRef,
  cancelSpeech,
  clearSpeechTimer,
  countdownIntervalRef,
  currentAnswerStartedAtRef,
  setDynamicFollowupUsedSec,
  setPreAnswerOverlay,
  setQaPhase,
  setUsedAnswerSec,
  startQuestionRecording,
  usedAnswerSec,
}: UseTrainingQaCountdownOptions) {
  const clearCountdownTimer = useCallback(() => {
    if (countdownIntervalRef.current !== null) {
      window.clearInterval(countdownIntervalRef.current);
      countdownIntervalRef.current = null;
    }
  }, [countdownIntervalRef]);

  const beginAnswering = useCallback(async () => {
    clearCountdownTimer();
    const currentUsedAnswerSec = Math.max(
      answerElapsedBeforePhaseRef.current,
      usedAnswerSec,
    );

    currentAnswerStartedAtRef.current = new Date();
    answerPhaseStartedMsRef.current = Date.now();
    answerElapsedBeforePhaseRef.current = currentUsedAnswerSec;
    setUsedAnswerSec(currentUsedAnswerSec);
    setDynamicFollowupUsedSec(0);
    setQaPhase("ANSWERING");
    // 确保评委语音已停止，避免被录进用户回答
    cancelSpeech();
    await startQuestionRecording();
  }, [
    answerElapsedBeforePhaseRef,
    answerPhaseStartedMsRef,
    cancelSpeech,
    clearCountdownTimer,
    currentAnswerStartedAtRef,
    setDynamicFollowupUsedSec,
    setQaPhase,
    setUsedAnswerSec,
    startQuestionRecording,
    usedAnswerSec,
  ]);

  const beginPreAnswerCountdown = useCallback(() => {
    clearSpeechTimer();
    clearCountdownTimer();
    setPreAnswerOverlay(4);

    countdownIntervalRef.current = window.setInterval(() => {
      setPreAnswerOverlay((previous) => {
        if (previous === null || previous <= 0) {
          clearCountdownTimer();
          return null;
        }

        const next = previous - 1;

        if (next <= 0) {
          clearCountdownTimer();
          void beginAnswering();
          return null;
        }

        return next;
      });
    }, 1000);
  }, [
    beginAnswering,
    clearCountdownTimer,
    clearSpeechTimer,
    countdownIntervalRef,
    setPreAnswerOverlay,
  ]);

  useEffect(() => {
    beginPreAnswerCountdownRef.current = beginPreAnswerCountdown;
  }, [beginPreAnswerCountdown, beginPreAnswerCountdownRef]);

  return { clearCountdownTimer };
}
