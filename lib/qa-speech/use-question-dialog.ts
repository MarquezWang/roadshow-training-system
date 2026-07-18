"use client";

import { useCallback } from "react";
import { devLog } from "@/lib/dev-log";
import { speechUnavailableMessage } from "./policy";
import type {
  QaSpeechQuestion,
  QuestionTextDialog,
  UseQaSpeechOptions,
} from "./types";
import type { SpeechResources } from "./use-speech-resources";

type UseQuestionDialogOptions = Pick<
  UseQaSpeechOptions,
  | "beginPreAnswerCountdown"
  | "hasAutoEndedRef"
  | "onMessageChange"
  | "onQuestionTextRevealed"
  | "sessionId"
> & {
  clearSpeechTimer: () => void;
  questionTextDialog: QuestionTextDialog;
  resources: SpeechResources;
  setQuestionTextDialog: (dialog: QuestionTextDialog) => void;
};

export function useQuestionDialog({
  beginPreAnswerCountdown,
  clearSpeechTimer,
  hasAutoEndedRef,
  onMessageChange,
  onQuestionTextRevealed,
  questionTextDialog,
  resources,
  sessionId,
  setQuestionTextDialog,
}: UseQuestionDialogOptions) {
  const { hasMoveOnRef, speechRunIdRef } = resources;

  const showQuestionTextFallback = useCallback(
    (question: QaSpeechQuestion, speechRunId: number, reason: string) => {
      if (speechRunIdRef.current !== speechRunId || hasAutoEndedRef.current) {
        return;
      }

      clearSpeechTimer();
      hasMoveOnRef.current = true;
      onQuestionTextRevealed(question.id);
      setQuestionTextDialog({
        question,
        mode: "fallback",
      });
      onMessageChange(speechUnavailableMessage);
      devLog("[QA TTS] 切换为文字提问", {
        sessionId,
        questionId: question.id,
        reason,
      });
    },
    [
      clearSpeechTimer,
      hasAutoEndedRef,
      hasMoveOnRef,
      onMessageChange,
      onQuestionTextRevealed,
      sessionId,
      setQuestionTextDialog,
      speechRunIdRef,
    ],
  );

  const confirmFallbackQuestionRead = useCallback(() => {
    if (!questionTextDialog || hasAutoEndedRef.current) {
      setQuestionTextDialog(null);
      return;
    }

    if (questionTextDialog.mode === "review") {
      setQuestionTextDialog(null);
      return;
    }

    setQuestionTextDialog(null);
    onMessageChange("");
    beginPreAnswerCountdown();
  }, [
    beginPreAnswerCountdown,
    hasAutoEndedRef,
    onMessageChange,
    questionTextDialog,
    setQuestionTextDialog,
  ]);

  return {
    confirmFallbackQuestionRead,
    showQuestionTextFallback,
  };
}
