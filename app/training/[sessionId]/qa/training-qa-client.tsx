"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { MicrophoneStatusBar } from "@/components/microphone-status-bar";
import type { DisplayMaterialNotice } from "@/lib/display-material";
import { useQaMaterialPreview } from "@/lib/use-qa-material-preview";
import { useQaPageGuards } from "@/lib/use-qa-page-guards";
import { useQaQuestionGeneration } from "@/lib/use-qa-question-generation";
import { useQaRecording } from "@/lib/use-qa-recording";
import {
  speechUnavailableMessage,
  useQaSpeech,
} from "@/lib/use-qa-speech";

type TrainingQaQuestion = {
  id: string;
  orderIndex: number;
  questionText: string;
  questionType: string | null;
  source: string;
  basis: string | null;
  answer: {
    id: string;
    answerText: string | null;
    revealedQuestionText: boolean;
    startedAt: string | null;
    endedAt: string | null;
    durationSec: number | null;
  } | null;
};

type QaFile = {
  id: string;
  originalName: string;
  fileType: string;
};

type TrainingQaClientProps = Readonly<{
  sessionId: string;
  projectName: string;
  initialStatus: string;
  initialQaStartedAt: string | null;
  initialRemainingSec: number;
  initialQuestions: TrainingQaQuestion[];
  previewFile: QaFile | null;
  previewNotice: DisplayMaterialNotice | null;
  files: QaFile[];
  dynamicFollowupExperiment: boolean;
}>;

type QaPhase = "READY" | "ASKING" | "COUNTDOWN" | "ANSWERING" | "SAVING" | "DONE";

const qaLimitSec = 3 * 60;
const dynamicFollowupAnswerLimitSec = 60;

type SaveAndContinueOptions = Readonly<{
  targetQuestionIndex?: number;
  forceFinish?: boolean;
}>;

function formatDuration(totalSec: number) {
  const normalizedSec = Math.max(0, totalSec);
  const minutes = Math.floor(normalizedSec / 60)
    .toString()
    .padStart(2, "0");
  const seconds = (normalizedSec % 60).toString().padStart(2, "0");

  return `${minutes}:${seconds}`;
}

function findInitialQuestionIndex(questions: TrainingQaQuestion[]) {
  const activeIndex = questions.findIndex(
    (question) => !question.answer?.endedAt,
  );

  return activeIndex >= 0 ? activeIndex : Math.max(0, questions.length - 1);
}

function isDynamicFollowupQuestion(question: TrainingQaQuestion | null) {
  return (
    question?.source === "DYNAMIC_FOLLOWUP" ||
    question?.questionType === "FOLLOWUP"
  );
}

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
  const initialQuestionIndex = findInitialQuestionIndex(initialQuestions);
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
  const beginJudgeQuestionRef = useRef<((questionIndex: number) => void) | null>(
    null,
  );
  const beginPreAnswerCountdownRef = useRef<(() => void) | null>(null);
  const dynamicFollowupIntroShownQuestionIdsRef = useRef<Set<string>>(
    new Set(
      initialStatus === "QAING" &&
        isDynamicFollowupQuestion(initialQuestions[initialQuestionIndex] ?? null)
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
  const isLastQuestion = currentQuestionIndex >= questions.length - 1;
  const nextDynamicFollowupIndex = questions.findIndex(
    (question, index) =>
      index > currentQuestionIndex &&
      isDynamicFollowupQuestion(question) &&
      !question.answer?.endedAt,
  );
  const shouldSkipToDynamicFollowup =
    !isCurrentDynamicFollowup &&
    remainingSec <= 30 &&
    nextDynamicFollowupIndex >= 0;
  const hasNextBaseQuestion = questions
    .slice(currentQuestionIndex + 1)
    .some((question) => !isDynamicFollowupQuestion(question));
  const shouldFinishAfterCurrent =
    isCurrentDynamicFollowup ||
    isLastQuestion ||
    (!shouldSkipToDynamicFollowup && remainingSec <= 30 && hasNextBaseQuestion);
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
          ? questions[options.targetQuestionIndex] ?? null
          : null;
      const shouldFinish =
        options.forceFinish ?? (targetQuestion ? false : shouldFinishAfterCurrent);

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
        setMessage(error instanceof Error ? error.message : "保存本题回答失败。");
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
  }, [beginJudgeQuestion, initialQuestionIndex, initialStatus, isGuardResolved, questions.length]);

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

      const nextIndex = findInitialQuestionIndex(questions);

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

  const phaseLabel =
    qaPhase === "ASKING"
        ? "评委正在提问"
        : qaPhase === "COUNTDOWN"
          ? "准备回答"
          : qaPhase === "ANSWERING"
            ? "回答中"
            : qaPhase === "SAVING"
              ? "保存当前题"
              : qaPhase === "DONE"
                ? "答辩已完成"
                : "答辩准备";
  const mainButtonLabel = shouldSkipToDynamicFollowup
    ? "进入动态追问"
    : shouldFinishAfterCurrent
      ? "完成答辩"
      : "回答完毕，进入下一题";

  return (
    <>
      {!isGuardResolved ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70">
          <p className="text-xl font-semibold text-white">正在结束训练...</p>
        </div>
      ) : null}
      {dynamicFollowupIntroQuestion ? (
        <div className="fixed inset-0 z-[60] flex items-center justify-center overflow-hidden bg-slate-950/45 bg-[radial-gradient(circle_at_80%_20%,rgba(99,102,241,0.16),transparent_34%),radial-gradient(circle_at_20%_80%,rgba(34,211,238,0.10),transparent_36%)] px-6 backdrop-blur-sm">
          <div className="absolute inset-0 bg-[linear-gradient(90deg,transparent,rgba(125,211,252,0.05),transparent)] animate-[followupSweep_2.6s_ease-in-out_forwards]" />
          <div className="relative w-full max-w-lg animate-[followupCard_2.6s_cubic-bezier(0.22,1,0.36,1)_forwards] overflow-hidden rounded-lg border border-cyan-300/35 bg-slate-950/80 p-1 shadow-[0_0_38px_rgba(34,211,238,0.18)]">
            <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-cyan-200 to-transparent" />
            <div className="absolute -right-10 -top-10 h-28 w-28 rounded-full bg-violet-400/12 blur-3xl" />
            <div className="absolute -bottom-10 -left-10 h-28 w-28 rounded-full bg-cyan-300/12 blur-3xl" />
            <div className="relative overflow-hidden rounded-md border border-white/10 bg-[linear-gradient(135deg,rgba(15,23,42,0.88),rgba(30,41,59,0.78))] p-7 text-left">
              <div className="pointer-events-none absolute inset-0 bg-[repeating-linear-gradient(0deg,rgba(255,255,255,0.03)_0px,rgba(255,255,255,0.03)_1px,transparent_1px,transparent_10px)] opacity-35" />
              <div className="relative flex items-center justify-between gap-4">
                <span className="inline-flex rounded-full border border-cyan-300/40 bg-cyan-300/10 px-3 py-1 text-xs font-semibold tracking-[0.18em] text-cyan-100">
                  DYNAMIC FOLLOW-UP
                </span>
                <span className="relative flex h-10 w-10 items-center justify-center rounded-full border border-violet-300/35 bg-violet-400/10">
                  <span className="absolute h-full w-full animate-ping rounded-full border border-cyan-200/25" />
                  <span className="h-2.5 w-2.5 animate-pulse rounded-full bg-cyan-200" />
                </span>
              </div>
              <div className="relative mt-8">
                <p className="text-sm font-medium text-cyan-200">动态追问</p>
                <h2 className="mt-2 text-4xl font-semibold tracking-wide text-white">
                  特殊追问回合
                </h2>
                <p className="mt-4 text-base leading-7 text-slate-200">
                  系统已根据本轮路演内容生成追问
                </p>
                <p className="mt-2 text-sm font-medium text-cyan-200">
                  本题独立限时 1 分钟
                </p>
              </div>
              <div className="relative mt-7 h-1 overflow-hidden rounded-full bg-slate-800">
                <div className="h-full w-2/3 animate-[followupBar_2.5s_ease-in-out_forwards] rounded-full bg-gradient-to-r from-cyan-300 via-blue-400 to-violet-400" />
              </div>
            </div>
          </div>
          <style jsx>{`
            @keyframes followupCard {
              0% {
                opacity: 0;
                transform: translateX(80vw) scale(0.96);
              }
              18% {
                opacity: 1;
                transform: translateX(0) scale(1);
              }
              74% {
                opacity: 1;
                transform: translateX(0) scale(1);
              }
              100% {
                opacity: 0;
                transform: translateX(-70vw) scale(0.98);
              }
            }

            @keyframes followupSweep {
              0% {
                transform: translateX(70vw);
                opacity: 0;
              }
              25% {
                opacity: 1;
              }
              100% {
                transform: translateX(-70vw);
                opacity: 0;
              }
            }

            @keyframes followupBar {
              0% {
                transform: translateX(-120%);
              }
              82% {
                transform: translateX(24%);
              }
              100% {
                transform: translateX(120%);
              }
            }
          `}</style>
        </div>
      ) : null}
      {questionTextDialog ? (
        <div className="fixed inset-0 z-[70] flex items-center justify-center bg-slate-950/80 px-5 backdrop-blur-sm">
          <div className="w-full max-w-2xl rounded-2xl border border-slate-700 bg-slate-950 p-6 shadow-2xl shadow-black/40">
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="text-xs font-semibold tracking-[0.18em] text-cyan-200">
                  QUESTION TEXT
                </p>
                <h2 className="mt-2 text-2xl font-semibold text-white">
                  评委提问
                </h2>
              </div>
              <span className="rounded-full border border-cyan-300/30 bg-cyan-300/10 px-3 py-1 text-xs font-medium text-cyan-100">
                {questionTextDialog.mode === "fallback"
                  ? "已切换为文字"
                  : questionTextDialog.mode === "review"
                    ? "题目文字"
                    : "语音提问中"}
              </span>
            </div>

            <p className="mt-5 rounded-lg border border-slate-700 bg-slate-900/70 p-4 text-sm leading-6 text-slate-200">
              {questionTextDialog.mode === "fallback"
                ? "当前浏览器未能播放语音，已自动显示本题文字。请阅读题目后再开始回答。"
                : questionTextDialog.mode === "review"
                  ? "这是当前评委问题文字。关闭后可以继续答辩。"
                  : "评委正在语音提问，题目文字同步展示。语音结束后将自动进入“请准备、3、2、1”。"}
            </p>

            <div className="mt-4 rounded-xl border border-slate-700 bg-slate-900 p-5">
              <p className="text-xs font-medium uppercase text-slate-400">
                Q{questionTextDialog.question.orderIndex} /{" "}
                {questionTextDialog.question.questionType ?? "QUESTION"}
              </p>
              {questionTextDialog.question.source === "DYNAMIC_FOLLOWUP" ? (
                <span className="mt-3 inline-block rounded bg-blue-900/60 px-2 py-0.5 text-xs font-medium text-blue-200">
                  基于本轮路演追问
                </span>
              ) : null}
              <p className="mt-3 text-lg font-semibold leading-8 text-white">
                {questionTextDialog.question.questionText}
              </p>
              {questionTextDialog.question.basis ? (
                <p className="mt-3 text-xs leading-5 text-slate-400">
                  依据：{questionTextDialog.question.basis}
                </p>
              ) : null}
            </div>

            {questionTextDialog.mode !== "reading" ? (
            <div className="mt-6 flex justify-end">
              <button
                type="button"
                onClick={confirmFallbackQuestionRead}
                className="inline-flex h-11 items-center justify-center rounded-md bg-cyan-300 px-5 text-sm font-semibold text-slate-950 transition-colors hover:bg-cyan-200"
              >
                {questionTextDialog.mode === "fallback"
                  ? "我已阅读，开始回答"
                  : "关闭"}
              </button>
            </div>
            ) : null}
          </div>
        </div>
      ) : null}
      {preAnswerOverlay !== null && isCurrentDynamicFollowup ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/35 bg-[radial-gradient(circle_at_center,rgba(79,70,229,0.10),transparent_42%)] backdrop-blur-sm">
          <div className="relative flex h-64 w-64 items-center justify-center rounded-full border border-cyan-300/15 bg-slate-950/45 shadow-[0_0_24px_rgba(34,211,238,0.14)]">
            <span className="absolute inset-3 animate-pulse rounded-full border border-cyan-200/20" />
            <span className="absolute inset-8 rounded-full border border-violet-300/15" />
            <span className="absolute h-full w-full animate-ping rounded-full border border-cyan-300/10" />
            <div className="relative text-center">
              <p className="text-xs font-semibold tracking-[0.18em] text-cyan-100">
                动态追问
              </p>
              <p className="mt-5 animate-pulse text-7xl font-bold text-white drop-shadow-[0_0_10px_rgba(125,211,252,0.45)]">
                {preAnswerOverlay >= 4
                  ? "请准备"
                  : preAnswerOverlay >= 1
                    ? String(preAnswerOverlay)
                    : "开始回答"}
              </p>
            </div>
          </div>
        </div>
      ) : null}
      {preAnswerOverlay !== null && !isCurrentDynamicFollowup ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70">
          <p className="text-6xl font-bold text-white">
            {preAnswerOverlay >= 4
              ? "请准备"
              : preAnswerOverlay >= 1
                ? String(preAnswerOverlay)
                : "请开始回答"}
          </p>
        </div>
      ) : null}
      {shouldShowMessageToast ? (
        <div className="fixed bottom-20 left-1/2 z-40 w-[min(42rem,calc(100vw-2rem))] -translate-x-1/2 rounded-lg border border-slate-700 bg-slate-950/90 p-3 text-center text-sm leading-6 text-slate-200 shadow-2xl shadow-black/40">
          <p>{message}</p>
        </div>
      ) : null}
      <div className="grid h-[calc(100vh-1.5rem)] w-full gap-3 overflow-hidden bg-slate-950 text-white">
      <section className="flex min-h-0 flex-col rounded-lg border border-slate-700 bg-slate-900/95 p-3 shadow-2xl">
        <div className="flex flex-col gap-3 border-b border-slate-700 pb-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <p className="text-xs font-medium text-slate-400">{projectName}</p>
            <p className="mt-1 text-xs font-medium text-slate-400">
              当前阶段：模拟答辩
            </p>
            <h2 className="mt-1 text-2xl font-semibold text-white">
              {phaseLabel}
            </h2>
            <p className="mt-1 text-sm text-slate-300">
              答辩阶段可翻阅材料，不写入路演翻页事件。
            </p>
          </div>
          <div className="text-left sm:text-right">
            <p className="text-xs font-medium text-slate-400">剩余答题时间</p>
            <p
              className={
                remainingSec <= 30
                  ? "mt-1 text-5xl font-semibold text-red-300"
                  : "mt-1 text-5xl font-semibold text-white"
              }
            >
              {formatDuration(remainingSec)}
            </p>
            <p className="mt-1 text-sm text-slate-300">
              {questions.length > 0 && currentQuestion
                ? `${currentQuestion.orderIndex} / ${questions.length}`
                : `0 / ${questions.length}`}
            </p>
          </div>
        </div>

        <div className="mt-3 grid min-h-0 flex-1 place-items-center rounded-lg border border-slate-700 bg-slate-950 p-2 text-center">
          {previewFile ? (
            <div className="grid h-full min-h-0 w-full grid-rows-[auto_minmax(0,1fr)] gap-3">
              <div className="flex flex-col gap-2 text-left sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <p className="text-sm font-medium text-white">
                    {previewFile.originalName}
                  </p>
                  <p className="mt-1 text-xs text-slate-300">
                    PDF 单页预览，当前 {pageLabel}
                  </p>
                </div>
                <div className="hidden">
                  <div className="inline-flex rounded-md border border-slate-700 bg-slate-900 p-1">
                    <button
                      type="button"
                      onClick={() => setPreviewMode("standard")}
                      className={
                        previewMode === "standard"
                          ? "rounded bg-white px-2.5 py-1 text-xs font-medium text-slate-950"
                          : "rounded px-2.5 py-1 text-xs font-medium text-slate-300 hover:bg-slate-800"
                      }
                    >
                      标准预览
                    </button>
                    <button
                      type="button"
                      onClick={() => setPreviewMode("compatible")}
                      className={
                        previewMode === "compatible"
                          ? "rounded bg-white px-2.5 py-1 text-xs font-medium text-slate-950"
                          : "rounded px-2.5 py-1 text-xs font-medium text-slate-300 hover:bg-slate-800"
                      }
                    >
                      兼容预览
                    </button>
                  </div>
                  <span className="inline-flex rounded-md border border-slate-700 bg-slate-900 px-2.5 py-1 text-xs font-medium text-slate-300">
                    辅助翻页
                  </span>
                </div>
              </div>

              <div
                ref={previewContainerRef}
                className={
                  previewMode === "standard"
                    ? "grid h-full min-h-0 place-items-center overflow-hidden rounded-md border border-slate-700 bg-slate-950 p-2"
                    : "grid h-full min-h-0 overflow-hidden rounded-md border border-slate-700 bg-slate-950"
                }
              >
                {previewMode === "compatible" && compatiblePreviewUrl ? (
                  <iframe
                    title={`${previewFile.originalName} 兼容预览`}
                    src={compatiblePreviewUrl}
                    className="h-full min-h-0 w-full border-0 bg-white"
                  />
                ) : isPdfLoading ? (
                  <p className="rounded-md bg-white px-4 py-3 text-sm text-slate-600 shadow-sm">
                    PDF 加载中...
                  </p>
                ) : pdfError ? (
                  <p className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
                    {pdfError}
                  </p>
                ) : (
                  <canvas
                    ref={canvasRef}
                    className="max-h-full max-w-full rounded-sm bg-white shadow"
                  />
                )}
              </div>
            </div>
          ) : previewNotice ? (
            <div>
              <p className="rounded-md border border-slate-700 bg-slate-900 px-4 py-3 text-sm leading-6 text-slate-300">
                {previewNotice.message}
              </p>
              <p className="mt-3 text-sm text-slate-400">
                仍可继续答辩。
              </p>
            </div>
          ) : (
            <div>
              <p className="text-sm font-medium text-slate-300">
                当前没有可预览的 PDF 材料
              </p>
              <p className="mt-3 text-sm text-slate-400">
                仍可继续答辩。
              </p>
            </div>
          )}
        </div>

        <div className="mt-3 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex flex-wrap gap-2">
            {isGenerating ? (
              <button
                type="button"
                disabled
                className="inline-flex h-10 items-center justify-center rounded-md bg-white px-4 text-sm font-medium text-slate-950 transition-colors disabled:cursor-not-allowed disabled:bg-slate-700 disabled:text-slate-400"
              >
                评委问题准备中...
              </button>
            ) : !isQaing && questions.length > 0 ? (
              <button
                type="button"
                onClick={() => void startQa()}
                disabled={isStarting}
                className="inline-flex h-10 items-center justify-center rounded-md bg-white px-4 text-sm font-medium text-slate-950 transition-colors hover:bg-slate-200 disabled:cursor-not-allowed disabled:bg-slate-700 disabled:text-slate-400"
              >
                开始答辩
              </button>
            ) : isQaing && qaPhase === "ANSWERING" ? (
              <button
                type="button"
                onClick={() =>
                  void saveAndContinue(
                    shouldSkipToDynamicFollowup
                      ? {
                          targetQuestionIndex: nextDynamicFollowupIndex,
                          forceFinish: false,
                        }
                      : undefined,
                  )
                }
                disabled={isSaving}
                className="inline-flex h-10 items-center justify-center rounded-md bg-white px-4 text-sm font-medium text-slate-950 transition-colors hover:bg-slate-200 disabled:cursor-not-allowed disabled:bg-slate-700 disabled:text-slate-400"
              >
                {isSaving ? "保存中..." : mainButtonLabel}
              </button>
            ) : null}
            {isQaing && currentQuestion ? (
              <button
                type="button"
                onClick={revealQuestionText}
                className="inline-flex h-10 items-center justify-center rounded-md border border-slate-600 bg-slate-900 px-4 text-sm font-medium text-white transition-colors hover:bg-slate-800"
              >
                查看问题文字
              </button>
            ) : null}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <MicrophoneStatusBar />
            <button
              type="button"
              onClick={() => changeMaterialPage("PREV")}
              disabled={!canGoPrev}
              className="inline-flex h-10 items-center justify-center rounded-md border border-slate-300 bg-white px-4 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-50 disabled:cursor-not-allowed disabled:bg-slate-100 disabled:text-slate-400"
            >
              上一页
            </button>
            <button
              type="button"
              onClick={() => changeMaterialPage("NEXT")}
              disabled={!canGoNext}
              className="inline-flex h-10 items-center justify-center rounded-md border border-slate-300 bg-white px-4 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-50 disabled:cursor-not-allowed disabled:bg-slate-100 disabled:text-slate-400"
            >
              下一页
            </button>
          </div>
        </div>
      </section>

    </div>
    </>
  );
}
