"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { DisplayMaterialNotice } from "@/lib/display-material";
import {
  useQaMaterialPreview,
  type QaPreviewFile,
} from "@/lib/use-qa-material-preview";
import { useQaPageGuards } from "@/lib/use-qa-page-guards";
import { useQaQuestionGeneration } from "@/lib/use-qa-question-generation";
import { useQaRecording } from "@/lib/use-qa-recording";
import { speechUnavailableMessage, useQaSpeech } from "@/lib/use-qa-speech";
import {
  findInitialQaQuestionIndex,
  getQaProgression,
  isDynamicFollowupQuestion,
} from "./training-qa/training-qa-flow";
import { getQaPhaseLabel } from "./training-qa/training-qa-format";
import { TrainingQaOverlays } from "./training-qa/training-qa-overlays";
import { TrainingQaStage } from "./training-qa/training-qa-stage";
import type {
  QaPhase,
  TrainingQaQuestion,
} from "./training-qa/training-qa-types";

type TrainingQaClientProps = Readonly<{
  sessionId: string;
  projectName: string;
  initialStatus: string;
  initialRemainingSec: number;
  initialQuestions: TrainingQaQuestion[];
  previewFile: QaPreviewFile | null;
  previewNotice: DisplayMaterialNotice | null;
  dynamicFollowupExperiment: boolean;
}>;

const qaLimitSec = 3 * 60;
const dynamicFollowupAnswerLimitSec = 60;

type SaveAndContinueOptions = Readonly<{
  targetQuestionIndex?: number;
  forceFinish?: boolean;
}>;

export function TrainingQaClient({
  sessionId,
  projectName,
  initialStatus,
  initialRemainingSec,
  initialQuestions,
  previewFile,
  previewNotice,
  dynamicFollowupExperiment,
}: TrainingQaClientProps) {
  const router = useRouter();
  const initialQuestionIndex = findInitialQaQuestionIndex(initialQuestions);
  const [status, setStatus] = useState(initialStatus);
  const [qaPhase, setQaPhase] = useState<QaPhase>(
    initialStatus === "QAING" ? "ASKING" : "READY",
  );
  const [questions, setQuestions] =
    useState<TrainingQaQuestion[]>(initialQuestions);
  const [currentQuestionIndex, setCurrentQuestionIndex] =
    useState(initialQuestionIndex);
  const [revealedQuestionIds, setRevealedQuestionIds] = useState<Set<string>>(
    () =>
      new Set(
        initialQuestions
          .filter((question) => question.answer?.revealedQuestionText)
          .map((question) => question.id),
      ),
  );
  const [usedAnswerSec, setUsedAnswerSec] = useState(
    Math.max(0, qaLimitSec - Math.min(initialRemainingSec, qaLimitSec)),
  );
  const [dynamicFollowupUsedSec, setDynamicFollowupUsedSec] = useState(0);
  const [message, setMessage] = useState("");
  const [isStarting, setIsStarting] = useState(false);
  const [preAnswerOverlay, setPreAnswerOverlay] = useState<number | null>(null);
  const [dynamicFollowupIntroQuestion, setDynamicFollowupIntroQuestion] =
    useState<TrainingQaQuestion | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const currentAnswerStartedAtRef = useRef<Date | null>(
    initialStatus === "QAING" ? new Date() : null,
  );
  const answerPhaseStartedMsRef = useRef<number | null>(null);
  const answerElapsedBeforePhaseRef = useRef(
    Math.max(0, qaLimitSec - Math.min(initialRemainingSec, qaLimitSec)),
  );
  const countdownIntervalRef = useRef<number | null>(null);
  const dynamicFollowupIntroTimerRef = useRef<number | null>(null);
  const beginJudgeQuestionRef = useRef<
    ((questionIndex: number) => void) | null
  >(null);
  const beginPreAnswerCountdownRef = useRef<(() => void) | null>(null);
  const dynamicFollowupIntroShownQuestionIdsRef = useRef<Set<string>>(
    new Set(
      initialStatus === "QAING" &&
        isDynamicFollowupQuestion(
          initialQuestions[initialQuestionIndex] ?? null,
        )
        ? [initialQuestions[initialQuestionIndex]!.id]
        : [],
    ),
  );
  const hasAutoEndedRef = useRef(false);
  const hasResumedQaingRef = useRef(false);
  const isCompletingNormallyRef = useRef(false);
  const currentQuestion = questions[currentQuestionIndex] ?? null;
  const isQaing = status === "QAING";
  const isCurrentDynamicFollowup = isDynamicFollowupQuestion(currentQuestion);
  const currentQuestionLimitSec = isCurrentDynamicFollowup
    ? dynamicFollowupAnswerLimitSec
    : qaLimitSec;
  const currentQuestionUsedSec = isCurrentDynamicFollowup
    ? dynamicFollowupUsedSec
    : usedAnswerSec;
  const remainingSec = Math.max(
    0,
    currentQuestionLimitSec - currentQuestionUsedSec,
  );
  const {
    nextDynamicFollowupIndex,
    shouldSkipToDynamicFollowup,
    shouldFinishAfterCurrent,
  } = getQaProgression(questions, currentQuestionIndex, remainingSec);
  const {
    canvasRef,
    previewContainerRef,
    compatiblePreviewUrl,
    canGoPrev,
    canGoNext,
    pageLabel,
    isPdfLoading,
    pdfError,
    previewMode,
    setPreviewMode,
    changeMaterialPage,
  } = useQaMaterialPreview({ previewFile });
  const { isGuardResolved } = useQaPageGuards({
    sessionId,
    initialStatus,
    status,
    isCompletingNormallyRef,
  });

  function clearCountdownTimer() {
    if (countdownIntervalRef.current !== null) {
      window.clearInterval(countdownIntervalRef.current);
      countdownIntervalRef.current = null;
    }
  }

  const clearDynamicFollowupIntroTimer = useCallback(() => {
    if (dynamicFollowupIntroTimerRef.current !== null) {
      window.clearTimeout(dynamicFollowupIntroTimerRef.current);
      dynamicFollowupIntroTimerRef.current = null;
    }
  }, []);

  const markQuestionTextRevealed = useCallback((questionId: string) => {
    setRevealedQuestionIds((current) => {
      const next = new Set(current);

      next.add(questionId);

      return next;
    });
  }, []);

  const {
    questionTextDialog,
    setQuestionTextDialog,
    clearSpeechTimer,
    cancelSpeech,
    confirmFallbackQuestionRead,
    startQuestionSpeech,
  } = useQaSpeech({
    sessionId,
    status,
    hasAutoEndedRef,
    beginPreAnswerCountdown: () => {
      beginPreAnswerCountdownRef.current?.();
    },
    onMessageChange: setMessage,
    onQuestionTextRevealed: markQuestionTextRevealed,
  });

  const {
    clearRecordingMessage,
    cleanupRecording,
    startQuestionRecording,
    stopAndUploadCurrentRecording,
  } = useQaRecording({ sessionId });

  const { isGenerating } = useQaQuestionGeneration({
    sessionId,
    dynamicFollowupExperiment,
    isGuardResolved,
    qaPhase,
    questions,
    setQuestions,
    setCurrentQuestionIndex,
    setMessage,
  });

  const shouldShowMessageToast =
    Boolean(message) &&
    !questionTextDialog &&
    message !== "答辩问题已生成。开始前不会展示完整题目。" &&
    message !== "评委问题生成时间较长，请稍候……" &&
    message !== speechUnavailableMessage;

  const getCurrentUsedAnswerSec = useCallback(() => {
    if (isDynamicFollowupQuestion(currentQuestion)) {
      if (qaPhase !== "ANSWERING" || answerPhaseStartedMsRef.current === null) {
        return dynamicFollowupUsedSec;
      }

      const elapsedInPhase = Math.max(
        0,
        Math.floor((Date.now() - answerPhaseStartedMsRef.current) / 1000),
      );

      return Math.min(dynamicFollowupAnswerLimitSec, elapsedInPhase);
    }

    if (qaPhase !== "ANSWERING" || answerPhaseStartedMsRef.current === null) {
      return usedAnswerSec;
    }

    const elapsedInPhase = Math.max(
      0,
      Math.floor((Date.now() - answerPhaseStartedMsRef.current) / 1000),
    );

    return Math.min(
      qaLimitSec,
      answerElapsedBeforePhaseRef.current + elapsedInPhase,
    );
  }, [currentQuestion, dynamicFollowupUsedSec, qaPhase, usedAnswerSec]);

  const getSessionQaDurationSec = useCallback(() => {
    const currentUsedSec = getCurrentUsedAnswerSec();

    if (!isDynamicFollowupQuestion(currentQuestion)) {
      return currentUsedSec;
    }

    return Math.min(qaLimitSec, usedAnswerSec) + currentUsedSec;
  }, [currentQuestion, getCurrentUsedAnswerSec, usedAnswerSec]);

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
  }, [cancelSpeech, startQuestionRecording, usedAnswerSec]);

  const beginPreAnswerCountdown = useCallback(() => {
    clearSpeechTimer();
    clearCountdownTimer();
    setPreAnswerOverlay(4);

    countdownIntervalRef.current = window.setInterval(() => {
      setPreAnswerOverlay((prev) => {
        if (prev === null || prev <= 0) {
          if (countdownIntervalRef.current !== null) {
            window.clearInterval(countdownIntervalRef.current);
            countdownIntervalRef.current = null;
          }
          return null;
        }
        const next = prev - 1;
        if (next <= 0) {
          if (countdownIntervalRef.current !== null) {
            window.clearInterval(countdownIntervalRef.current);
            countdownIntervalRef.current = null;
          }
          void beginAnswering();
          return null;
        }
        return next;
      });
    }, 1000);
  }, [beginAnswering, clearSpeechTimer]);

  useEffect(() => {
    beginPreAnswerCountdownRef.current = beginPreAnswerCountdown;
  }, [beginPreAnswerCountdown]);

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

      setCurrentQuestionIndex(questionIndex);
      setDynamicFollowupIntroQuestion(null);
      setQaPhase("ASKING");
      startQuestionSpeech(question);
    },
    [
      cancelSpeech,
      clearRecordingMessage,
      clearDynamicFollowupIntroTimer,
      clearSpeechTimer,
      questions,
      setQuestionTextDialog,
      startQuestionSpeech,
    ],
  );

  useEffect(() => {
    beginJudgeQuestionRef.current = beginJudgeQuestion;
  }, [beginJudgeQuestion]);

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
          body: JSON.stringify({
            questionId: question?.id,
            answerStartedAt: currentAnswerStartedAtRef.current?.toISOString(),
            revealedQuestionText: question
              ? revealedQuestionIds.has(question.id)
              : false,
            recordingId,
            qaDurationSec: getSessionQaDurationSec(),
          }),
        });

        if (!response.ok) {
          const body = (await response.json().catch(() => null)) as {
            error?: string;
          } | null;

          throw new Error(body?.error ?? "完成答辩失败。");
        }

        setQaPhase("DONE");
        isCompletingNormallyRef.current = true;
        router.push(`/training/${sessionId}/report`);
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
      clearSpeechTimer,
      getSessionQaDurationSec,
      revealedQuestionIds,
      router,
      sessionId,
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
            body: JSON.stringify({
              answerStartedAt: currentAnswerStartedAtRef.current?.toISOString(),
              revealedQuestionText: revealedQuestionIds.has(currentQuestion.id),
              recordingId,
              qaDurationSec: getSessionQaDurationSec(),
              finish: shouldFinish,
              preferredNextQuestionId: targetQuestion?.id,
            }),
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
          router.push(`/training/${sessionId}/report`);
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
      beginJudgeQuestion,
      currentQuestion,
      currentQuestionIndex,
      getCurrentUsedAnswerSec,
      getSessionQaDurationSec,
      qaPhase,
      questions,
      revealedQuestionIds,
      router,
      sessionId,
      shouldFinishAfterCurrent,
      stopAndUploadCurrentRecording,
    ],
  );

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
          dynamicFollowupAnswerLimitSec,
          elapsedInPhase,
        );

        setDynamicFollowupUsedSec(nextUsedSec);

        if (nextUsedSec >= dynamicFollowupAnswerLimitSec) {
          window.clearInterval(timer);
          void finishQaWithCurrentQuestion(currentQuestion);
        }

        return;
      }

      const nextUsedSec = Math.min(
        qaLimitSec,
        answerElapsedBeforePhaseRef.current + elapsedInPhase,
      );

      setUsedAnswerSec(nextUsedSec);

      if (nextUsedSec >= qaLimitSec) {
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
    currentQuestion,
    finishQaWithCurrentQuestion,
    isQaing,
    nextDynamicFollowupIndex,
    qaPhase,
    saveAndContinue,
  ]);

  useEffect(() => {
    if (
      initialStatus !== "QAING" ||
      !isGuardResolved ||
      hasResumedQaingRef.current ||
      questions.length === 0
    ) {
      return;
    }

    hasResumedQaingRef.current = true;
    beginJudgeQuestion(initialQuestionIndex);
  }, [
    beginJudgeQuestion,
    initialQuestionIndex,
    initialStatus,
    isGuardResolved,
    questions.length,
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
    clearDynamicFollowupIntroTimer,
    clearSpeechTimer,
  ]);

  async function startQa() {
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
  }

  function revealQuestionText() {
    if (!currentQuestion) {
      return;
    }

    markQuestionTextRevealed(currentQuestion.id);
    setQuestionTextDialog({
      question: currentQuestion,
      mode: "review",
    });
  }

  const handleSaveAnswer = useCallback(
    () =>
      saveAndContinue(
        shouldSkipToDynamicFollowup
          ? {
              targetQuestionIndex: nextDynamicFollowupIndex,
              forceFinish: false,
            }
          : undefined,
      ),
    [nextDynamicFollowupIndex, saveAndContinue, shouldSkipToDynamicFollowup],
  );
  const phaseLabel = getQaPhaseLabel(qaPhase);
  const mainButtonLabel = shouldSkipToDynamicFollowup
    ? "进入动态追问"
    : shouldFinishAfterCurrent
      ? "完成答辩"
      : "回答完毕，进入下一题";
  const questionProgressLabel =
    questions.length > 0 && currentQuestion
      ? [currentQuestion.orderIndex, questions.length].join(" / ")
      : ["0", questions.length].join(" / ");

  return (
    <>
      <TrainingQaOverlays
        isGuardResolved={isGuardResolved}
        showDynamicFollowupIntro={Boolean(dynamicFollowupIntroQuestion)}
        questionTextDialog={questionTextDialog}
        preAnswerOverlay={preAnswerOverlay}
        isCurrentDynamicFollowup={isCurrentDynamicFollowup}
        shouldShowMessageToast={shouldShowMessageToast}
        message={message}
        onConfirmQuestionText={confirmFallbackQuestionRead}
      />
      <div className="grid h-[calc(100vh-1.5rem)] w-full gap-3 overflow-hidden bg-slate-950 text-white">
        <TrainingQaStage
          projectName={projectName}
          phaseLabel={phaseLabel}
          remainingSec={remainingSec}
          questionProgressLabel={questionProgressLabel}
          previewFile={previewFile}
          previewNotice={previewNotice}
          pageLabel={pageLabel}
          previewMode={previewMode}
          compatiblePreviewUrl={compatiblePreviewUrl}
          previewContainerRef={previewContainerRef}
          canvasRef={canvasRef}
          isPdfLoading={isPdfLoading}
          pdfError={pdfError}
          canGoPrev={canGoPrev}
          canGoNext={canGoNext}
          isGenerating={isGenerating}
          canStartQa={!isQaing && questions.length > 0}
          canSaveAnswer={isQaing && qaPhase === "ANSWERING"}
          hasCurrentQuestion={isQaing && Boolean(currentQuestion)}
          isStarting={isStarting}
          isSaving={isSaving}
          mainButtonLabel={mainButtonLabel}
          onPreviewModeChange={setPreviewMode}
          onStartQa={startQa}
          onSaveAnswer={handleSaveAnswer}
          onRevealQuestionText={revealQuestionText}
          onChangeMaterialPage={changeMaterialPage}
        />
      </div>
    </>
  );
}
