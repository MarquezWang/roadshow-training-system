"use client";

import { useCallback } from "react";
import { buildMoveOn, isSpeechSynthesisSupported } from "./policy";
import type {
  QaSpeechQuestion,
  QuestionSpeechRun,
  QuestionTextDialog,
  UseQaSpeechOptions,
} from "./types";
import type { SpeechResources } from "./use-speech-resources";

type UseQuestionSpeechRunOptions = Pick<
  UseQaSpeechOptions,
  "beginPreAnswerCountdown" | "hasAutoEndedRef"
> & {
  fallbackToBrowserSpeech: (run: QuestionSpeechRun) => void;
  playTencentQuestionSpeech: (run: QuestionSpeechRun) => Promise<boolean>;
  resources: SpeechResources;
  setQuestionTextDialog: (dialog: QuestionTextDialog) => void;
  showQuestionTextFallback: (
    question: QaSpeechQuestion,
    speechRunId: number,
    reason: string,
  ) => void;
};

export function useQuestionSpeechRun({
  beginPreAnswerCountdown,
  fallbackToBrowserSpeech,
  hasAutoEndedRef,
  playTencentQuestionSpeech,
  resources,
  setQuestionTextDialog,
  showQuestionTextFallback,
}: UseQuestionSpeechRunOptions) {
  const { hasMoveOnRef, speechRunIdRef } = resources;

  const startQuestionSpeech = useCallback(
    (question: QaSpeechQuestion) => {
      const speechRunId = speechRunIdRef.current + 1;
      speechRunIdRef.current = speechRunId;
      hasMoveOnRef.current = false;
      setQuestionTextDialog({
        question,
        mode: "reading",
      });

      if (!isSpeechSynthesisSupported()) {
        showQuestionTextFallback(question, speechRunId, "unsupported");
        return;
      }

      const moveOn = buildMoveOn(hasMoveOnRef, () => {
        setQuestionTextDialog(null);
        beginPreAnswerCountdown();
      });
      const isCurrentSpeechRun = () =>
        speechRunIdRef.current === speechRunId && !hasAutoEndedRef.current;
      const run: QuestionSpeechRun = {
        isCurrentSpeechRun,
        moveOn,
        question,
        speechRunId,
        speechStartedRef: { current: false },
      };

      void playTencentQuestionSpeech(run).then((played) => {
        if (!played && isCurrentSpeechRun()) {
          fallbackToBrowserSpeech(run);
        }
      });
    },
    [
      beginPreAnswerCountdown,
      fallbackToBrowserSpeech,
      hasAutoEndedRef,
      hasMoveOnRef,
      playTencentQuestionSpeech,
      setQuestionTextDialog,
      showQuestionTextFallback,
      speechRunIdRef,
    ],
  );

  return { startQuestionSpeech };
}
