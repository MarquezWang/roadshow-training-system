"use client";

import { useCallback, useEffect } from "react";
import type { Dispatch, SetStateAction } from "react";
import type { QuestionTextDialog } from "@/lib/use-qa-speech";
import { isDynamicFollowupQuestion } from "./training-qa-flow";
import type { TrainingQaQuestion } from "./training-qa-types";
import type { TrainingQaState } from "./use-training-qa-state";

type UseTrainingQaQuestionFlowOptions = Pick<
  TrainingQaState,
  | "beginJudgeQuestionRef"
  | "dynamicFollowupIntroShownQuestionIdsRef"
  | "dynamicFollowupIntroTimerRef"
  | "questions"
  | "setCurrentQuestionIndex"
  | "setDynamicFollowupIntroQuestion"
  | "setMessage"
  | "setQaPhase"
> & {
  cancelSpeech: () => void;
  clearCountdownTimer: () => void;
  clearRecordingMessage: () => void;
  clearSpeechTimer: () => void;
  currentQuestion: TrainingQaQuestion | null;
  markQuestionStarted: (questionId: string) => void;
  markQuestionTextRevealed: (questionId: string) => void;
  setQuestionTextDialog: Dispatch<SetStateAction<QuestionTextDialog>>;
  startQuestionSpeech: (question: TrainingQaQuestion) => void;
};

export function useTrainingQaQuestionFlow({
  beginJudgeQuestionRef,
  cancelSpeech,
  clearCountdownTimer,
  clearRecordingMessage,
  clearSpeechTimer,
  currentQuestion,
  dynamicFollowupIntroShownQuestionIdsRef,
  dynamicFollowupIntroTimerRef,
  markQuestionStarted,
  markQuestionTextRevealed,
  questions,
  setCurrentQuestionIndex,
  setDynamicFollowupIntroQuestion,
  setMessage,
  setQaPhase,
  setQuestionTextDialog,
  startQuestionSpeech,
}: UseTrainingQaQuestionFlowOptions) {
  const clearDynamicFollowupIntroTimer = useCallback(() => {
    if (dynamicFollowupIntroTimerRef.current !== null) {
      window.clearTimeout(dynamicFollowupIntroTimerRef.current);
      dynamicFollowupIntroTimerRef.current = null;
    }
  }, [dynamicFollowupIntroTimerRef]);

  const beginJudgeQuestion = useCallback(
    (questionIndex: number) => {
      const question = questions[questionIndex];

      if (!question) {
        return;
      }

      clearDynamicFollowupIntroTimer();
      clearSpeechTimer();
      clearCountdownTimer();
      cancelSpeech();
      setMessage("");
      clearRecordingMessage();

      if (
        isDynamicFollowupQuestion(question) &&
        !dynamicFollowupIntroShownQuestionIdsRef.current.has(question.id)
      ) {
        dynamicFollowupIntroShownQuestionIdsRef.current.add(question.id);
        setQaPhase("ASKING");
        setQuestionTextDialog(null);
        setDynamicFollowupIntroQuestion(question);
        dynamicFollowupIntroTimerRef.current = window.setTimeout(() => {
          dynamicFollowupIntroTimerRef.current = null;
          setDynamicFollowupIntroQuestion(null);
          beginJudgeQuestionRef.current?.(questionIndex);
        }, 2500);
        return;
      }

      markQuestionStarted(question.id);
      setCurrentQuestionIndex(questionIndex);
      setDynamicFollowupIntroQuestion(null);
      setQaPhase("ASKING");
      startQuestionSpeech(question);
    },
    [
      beginJudgeQuestionRef,
      cancelSpeech,
      clearCountdownTimer,
      clearDynamicFollowupIntroTimer,
      clearRecordingMessage,
      clearSpeechTimer,
      dynamicFollowupIntroShownQuestionIdsRef,
      dynamicFollowupIntroTimerRef,
      markQuestionStarted,
      questions,
      setCurrentQuestionIndex,
      setDynamicFollowupIntroQuestion,
      setMessage,
      setQaPhase,
      setQuestionTextDialog,
      startQuestionSpeech,
    ],
  );

  useEffect(() => {
    beginJudgeQuestionRef.current = beginJudgeQuestion;
  }, [beginJudgeQuestion, beginJudgeQuestionRef]);

  const revealQuestionText = useCallback(() => {
    if (!currentQuestion) {
      return;
    }

    markQuestionTextRevealed(currentQuestion.id);
    setQuestionTextDialog({
      question: currentQuestion,
      mode: "review",
    });
  }, [currentQuestion, markQuestionTextRevealed, setQuestionTextDialog]);

  return {
    beginJudgeQuestion,
    clearDynamicFollowupIntroTimer,
    revealQuestionText,
  };
}
