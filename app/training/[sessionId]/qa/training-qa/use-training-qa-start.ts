"use client";

import { useCallback } from "react";
import { findInitialQaQuestionIndex } from "./training-qa-flow";
import type { TrainingQaState } from "./use-training-qa-state";

type UseTrainingQaStartOptions = Pick<
  TrainingQaState,
  | "answerElapsedBeforePhaseRef"
  | "hasAutoEndedRef"
  | "questions"
  | "setIsStarting"
  | "setMessage"
  | "setStatus"
  | "setUsedAnswerSec"
> & {
  beginJudgeQuestion: (questionIndex: number) => void;
  sessionId: string;
};

export function useTrainingQaStart({
  answerElapsedBeforePhaseRef,
  beginJudgeQuestion,
  hasAutoEndedRef,
  questions,
  sessionId,
  setIsStarting,
  setMessage,
  setStatus,
  setUsedAnswerSec,
}: UseTrainingQaStartOptions) {
  const startQa = useCallback(async () => {
    if (questions.length === 0) {
      setMessage("请先生成答辩问题。");
      return;
    }

    setIsStarting(true);
    setMessage("");

    try {
      const response = await fetch(`/training/${sessionId}/qa/start`, {
        method: "POST",
      });
      const body = (await response.json().catch(() => null)) as {
        session?: {
          status: string;
          qaStartedAt: string | null;
        };
        error?: string;
      } | null;

      if (!response.ok) {
        throw new Error(body?.error ?? "开始答辩失败。");
      }

      const nextIndex = findInitialQaQuestionIndex(questions);

      hasAutoEndedRef.current = false;
      setStatus(body?.session?.status ?? "QAING");
      setUsedAnswerSec(0);
      answerElapsedBeforePhaseRef.current = 0;
      beginJudgeQuestion(nextIndex);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "开始答辩失败。");
    } finally {
      setIsStarting(false);
    }
  }, [
    answerElapsedBeforePhaseRef,
    beginJudgeQuestion,
    hasAutoEndedRef,
    questions,
    sessionId,
    setIsStarting,
    setMessage,
    setStatus,
    setUsedAnswerSec,
  ]);

  return { startQa };
}
