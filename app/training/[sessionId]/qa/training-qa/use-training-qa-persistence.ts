"use client";

import { useCallback } from "react";
import {
  buildQaAnswerRequestBody,
  buildQaEndRequestBody,
} from "./training-qa-request";
import type { TrainingQaQuestion } from "./training-qa-types";
import type { TrainingQaState } from "./use-training-qa-state";

type SaveAndContinueOptions = Readonly<{
  targetQuestionIndex?: number;
  forceFinish?: boolean;
}>;

type UseTrainingQaPersistenceOptions = Pick<
  TrainingQaState,
  | "answerElapsedBeforePhaseRef"
  | "currentAnswerStartedAtRef"
  | "currentQuestionIndex"
  | "hasAutoEndedRef"
  | "isCompletingNormallyRef"
  | "qaPhase"
  | "questions"
  | "revealedQuestionIds"
  | "setIsSaving"
  | "setMessage"
  | "setQaPhase"
  | "setQuestions"
  | "setUsedAnswerSec"
> & {
  beginJudgeQuestion: (questionIndex: number) => void;
  cancelSpeech: () => void;
  clearCountdownTimer: () => void;
  clearSpeechTimer: () => void;
  currentQuestion: TrainingQaQuestion | null;
  getCurrentUsedAnswerSec: () => number;
  getSessionQaDurationSec: () => number;
  navigateToReport: () => void;
  sessionId: string;
  shouldFinishAfterCurrent: boolean;
  stopAndUploadCurrentRecording: () => Promise<string | null>;
};

export function useTrainingQaPersistence({
  answerElapsedBeforePhaseRef,
  beginJudgeQuestion,
  cancelSpeech,
  clearCountdownTimer,
  clearSpeechTimer,
  currentAnswerStartedAtRef,
  currentQuestion,
  currentQuestionIndex,
  getCurrentUsedAnswerSec,
  getSessionQaDurationSec,
  hasAutoEndedRef,
  isCompletingNormallyRef,
  navigateToReport,
  qaPhase,
  questions,
  revealedQuestionIds,
  sessionId,
  setIsSaving,
  setMessage,
  setQaPhase,
  setQuestions,
  setUsedAnswerSec,
  shouldFinishAfterCurrent,
  stopAndUploadCurrentRecording,
}: UseTrainingQaPersistenceOptions) {
  const finishQaWithCurrentQuestion = useCallback(
    async (question: TrainingQaQuestion | null) => {
      if (hasAutoEndedRef.current) {
        return;
      }

      hasAutoEndedRef.current = true;
      setIsSaving(true);
      setQaPhase("SAVING");
      setMessage("");
      clearSpeechTimer();
      clearCountdownTimer();
      cancelSpeech();

      try {
        const recordingId = await stopAndUploadCurrentRecording();
        const response = await fetch(`/training/${sessionId}/qa/end`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify(
            buildQaEndRequestBody({
              questionId: question?.id,
              answerStartedAt: currentAnswerStartedAtRef.current,
              revealedQuestionText: question
                ? revealedQuestionIds.has(question.id)
                : false,
              recordingId,
              qaDurationSec: getSessionQaDurationSec(),
            }),
          ),
        });

        if (!response.ok) {
          const body = (await response.json().catch(() => null)) as {
            error?: string;
          } | null;

          throw new Error(body?.error ?? "完成答辩失败。");
        }

        setQaPhase("DONE");
        isCompletingNormallyRef.current = true;
        navigateToReport();
      } catch (error) {
        hasAutoEndedRef.current = false;
        setQaPhase("ANSWERING");
        setMessage(error instanceof Error ? error.message : "完成答辩失败。");
      } finally {
        setIsSaving(false);
      }
    },
    [
      cancelSpeech,
      clearCountdownTimer,
      clearSpeechTimer,
      currentAnswerStartedAtRef,
      getSessionQaDurationSec,
      hasAutoEndedRef,
      isCompletingNormallyRef,
      navigateToReport,
      revealedQuestionIds,
      sessionId,
      setIsSaving,
      setMessage,
      setQaPhase,
      stopAndUploadCurrentRecording,
    ],
  );

  const saveAndContinue = useCallback(
    async (options: SaveAndContinueOptions = {}) => {
      if (!currentQuestion || qaPhase !== "ANSWERING") {
        return;
      }

      const targetQuestion =
        typeof options.targetQuestionIndex === "number"
          ? (questions[options.targetQuestionIndex] ?? null)
          : null;
      const shouldFinish =
        options.forceFinish ??
        (targetQuestion ? false : shouldFinishAfterCurrent);

      setIsSaving(true);
      setMessage("");

      try {
        const currentUsedAnswerSec = getCurrentUsedAnswerSec();

        setQaPhase("SAVING");
        const recordingId = await stopAndUploadCurrentRecording();
        const response = await fetch(
          `/training/${sessionId}/qa/questions/${currentQuestion.id}/answer`,
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
            },
            body: JSON.stringify(
              buildQaAnswerRequestBody({
                answerStartedAt: currentAnswerStartedAtRef.current,
                revealedQuestionText: revealedQuestionIds.has(
                  currentQuestion.id,
                ),
                recordingId,
                qaDurationSec: getSessionQaDurationSec(),
                finish: shouldFinish,
                preferredNextQuestionId: targetQuestion?.id,
              }),
            ),
          },
        );
        const body = (await response.json().catch(() => null)) as {
          completed?: boolean;
          nextQuestionId?: string;
          answer?: TrainingQaQuestion["answer"] & { questionId?: string };
          error?: string;
        } | null;

        if (!response.ok) {
          throw new Error(body?.error ?? "保存本题回答失败。");
        }

        if (body?.answer?.questionId) {
          const savedAnswer = body.answer;

          setQuestions((currentQuestions) =>
            currentQuestions.map((question) =>
              question.id === savedAnswer.questionId
                ? {
                    ...question,
                    answer: {
                      id: savedAnswer.id,
                      answerText: savedAnswer.answerText,
                      revealedQuestionText: savedAnswer.revealedQuestionText,
                      startedAt: savedAnswer.startedAt,
                      endedAt: savedAnswer.endedAt,
                      durationSec: savedAnswer.durationSec,
                    },
                  }
                : question,
            ),
          );
        }

        if (body?.completed) {
          setQaPhase("DONE");
          isCompletingNormallyRef.current = true;
          navigateToReport();
          return;
        }

        const nextIndex = questions.findIndex(
          (question) => question.id === body?.nextQuestionId,
        );
        const resolvedNextIndex =
          nextIndex >= 0 ? nextIndex : currentQuestionIndex;

        setUsedAnswerSec(currentUsedAnswerSec);
        answerElapsedBeforePhaseRef.current = currentUsedAnswerSec;
        beginJudgeQuestion(resolvedNextIndex);
      } catch (error) {
        setQaPhase("ANSWERING");
        setMessage(
          error instanceof Error ? error.message : "保存本题回答失败。",
        );
      } finally {
        setIsSaving(false);
      }
    },
    [
      answerElapsedBeforePhaseRef,
      beginJudgeQuestion,
      currentAnswerStartedAtRef,
      currentQuestion,
      currentQuestionIndex,
      getCurrentUsedAnswerSec,
      getSessionQaDurationSec,
      isCompletingNormallyRef,
      navigateToReport,
      qaPhase,
      questions,
      revealedQuestionIds,
      sessionId,
      setIsSaving,
      setMessage,
      setQaPhase,
      setQuestions,
      setUsedAnswerSec,
      shouldFinishAfterCurrent,
      stopAndUploadCurrentRecording,
    ],
  );

  return { finishQaWithCurrentQuestion, saveAndContinue };
}
