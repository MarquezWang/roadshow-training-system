"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { devLog } from "@/lib/dev-log";
import type {
  PDFDocumentLoadingTask,
  PDFDocumentProxy,
  RenderTask,
} from "pdfjs-dist";
import { useTrainingAbortGuard } from "@/lib/use-training-abort-guard";
import { MicrophoneStatusBar } from "@/components/microphone-status-bar";
import type { DisplayMaterialNotice } from "@/lib/display-material";
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
type PreviewMode = "standard" | "compatible";

const qaLimitSec = 3 * 60;
const dynamicFollowupAnswerLimitSec = 60;
const pdfWorkerSrc = new URL(
  "pdfjs-dist/build/pdf.worker.mjs",
  import.meta.url,
).toString();
const pdfCMapUrl = "/pdfjs/cmaps/";
const pdfStandardFontDataUrl = "/pdfjs/standard_fonts/";
const pdfWasmUrl = "/pdfjs/wasm/";
const pdfIccUrl = "/pdfjs/iccs/";
const dynamicFollowupRetryDelayMs = 3_000;
const dynamicFollowupMaxRetryCount = 10;

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

function isEditableOrClickableTarget(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) {
    return false;
  }

  return Boolean(
    target.closest(
      'input, textarea, select, button, a, [contenteditable="true"], [role="button"]',
    ),
  );
}

function canAttemptDynamicFollowupPhase(phase: QaPhase) {
  return phase !== "DONE";
}

function isDynamicFollowupQuestion(question: TrainingQaQuestion | null) {
  return (
    question?.source === "DYNAMIC_FOLLOWUP" ||
    question?.questionType === "FOLLOWUP"
  );
}

function isTranscriptNotReadyReason(reason: string | undefined) {
  if (!reason) {
    return false;
  }

  const normalizedReason = reason.trim().toLowerCase();

  return (
    normalizedReason === "dynamic_followup_in_progress" ||
    normalizedReason === "pitch_transcript_not_ready" ||
    normalizedReason === "transcript_not_ready" ||
    normalizedReason === "no_pitch_transcript" ||
    (normalizedReason.includes("transcript") &&
      (normalizedReason.includes("not_ready") ||
        normalizedReason.includes("not ready") ||
        normalizedReason.includes("missing")))
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
  const [isGenerating, setIsGenerating] = useState(false);
  const autoGenerateRef = useRef(false);
  const [isStarting, setIsStarting] = useState(false);
  const [preAnswerOverlay, setPreAnswerOverlay] = useState<number | null>(null);
  const [dynamicFollowupIntroQuestion, setDynamicFollowupIntroQuestion] =
    useState<TrainingQaQuestion | null>(null);
  const [isGuardResolved, setIsGuardResolved] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [pageIndex, setPageIndex] = useState(0);
  const [totalPages, setTotalPages] = useState<number | null>(null);
  const [isPdfLoading, setIsPdfLoading] = useState(Boolean(previewFile));
  const [pdfError, setPdfError] = useState("");
  const [pdfDocument, setPdfDocument] = useState<PDFDocumentProxy | null>(null);
  const [previewMode, setPreviewMode] = useState<PreviewMode>("standard");
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
  const qaPhaseRef = useRef<QaPhase>(qaPhase);
  const dynamicFollowupRetryCountRef = useRef(0);
  const dynamicFollowupInFlightRef = useRef(false);
  const dynamicFollowupCompletedRef = useRef(
    initialQuestions.some(isDynamicFollowupQuestion),
  );
  const dynamicFollowupRetryTimerRef = useRef<number | null>(null);
  const [dynamicFollowupRetryTick, setDynamicFollowupRetryTick] = useState(0);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const previewContainerRef = useRef<HTMLDivElement | null>(null);
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
  const hasNextBaseQuestion = questions
    .slice(currentQuestionIndex + 1)
    .some((question) => !isDynamicFollowupQuestion(question));
  const shouldFinishAfterCurrent =
    isCurrentDynamicFollowup ||
    isLastQuestion ||
    (remainingSec < 30 && hasNextBaseQuestion);
  const previewUrl = previewFile
    ? `/api/files/${previewFile.id}/preview`
    : null;
  const currentPageNumber = pageIndex + 1;
  const compatiblePreviewUrl = previewUrl
    ? `${previewUrl}#page=${currentPageNumber}`
    : null;
  const canGoPrev = pageIndex > 0;
  const canGoNext =
    previewFile && totalPages !== null ? pageIndex < totalPages - 1 : true;
  const pageLabel = totalPages
    ? `${currentPageNumber} / ${totalPages}`
    : String(currentPageNumber);
  useTrainingAbortGuard({
    sessionId,
    enabled: status === "QA_READY" || status === "QAING",
    isCompletingNormallyRef,
    onPendingAbortDetected: () => {
      void (async () => {
        try {
          await fetch(`/training/${sessionId}/abort`, { method: "POST" });
        } finally {
          router.replace(`/training/${sessionId}/report`);
        }
      })();
    },
  });

  useEffect(() => {
    const isActiveStatus = initialStatus === "QAING" || initialStatus === "QA_READY";
    if (!isActiveStatus) {
      queueMicrotask(() => setIsGuardResolved(true));
      return;
    }
    const key = `training:${sessionId}:pending-abort`;
    const hasPending = sessionStorage.getItem(key);
    if (hasPending) {
      sessionStorage.removeItem(key);
      void (async () => {
        try {
          await fetch(`/training/${sessionId}/abort`, { method: "POST" });
        } finally {
          router.replace(`/training/${sessionId}/report`);
        }
      })();
      return;
    }
    queueMicrotask(() => setIsGuardResolved(true));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const clearDynamicFollowupRetryTimer = useCallback(() => {
    if (dynamicFollowupRetryTimerRef.current !== null) {
      window.clearTimeout(dynamicFollowupRetryTimerRef.current);
      dynamicFollowupRetryTimerRef.current = null;
    }
  }, []);

  const scheduleDynamicFollowupRetry = useCallback(
    (reason: string) => {
      if (!canAttemptDynamicFollowupPhase(qaPhaseRef.current)) {
        return;
      }

      if (dynamicFollowupRetryCountRef.current >= dynamicFollowupMaxRetryCount) {
        dynamicFollowupCompletedRef.current = true;
        clearDynamicFollowupRetryTimer();
        devLog("[dynamic-followup:client] retry stopped", {
          sessionId,
          reason,
          retryCount: dynamicFollowupRetryCountRef.current,
          maxRetryCount: dynamicFollowupMaxRetryCount,
        });
        return;
      }

      clearDynamicFollowupRetryTimer();
      dynamicFollowupRetryCountRef.current += 1;
      const nextRetryCount = dynamicFollowupRetryCountRef.current;

      devLog("[dynamic-followup:client] retry scheduled", {
        sessionId,
        reason,
        retryCount: nextRetryCount,
        delayMs: dynamicFollowupRetryDelayMs,
      });

      dynamicFollowupRetryTimerRef.current = window.setTimeout(() => {
        dynamicFollowupRetryTimerRef.current = null;
        setDynamicFollowupRetryTick((currentTick) => currentTick + 1);
      }, dynamicFollowupRetryDelayMs);
    },
    [clearDynamicFollowupRetryTimer, sessionId],
  );

  useEffect(() => {
    return () => clearDynamicFollowupRetryTimer();
  }, [clearDynamicFollowupRetryTimer]);

  useEffect(() => {
    qaPhaseRef.current = qaPhase;

    if (!canAttemptDynamicFollowupPhase(qaPhase)) {
      clearDynamicFollowupRetryTimer();
    }
  }, [clearDynamicFollowupRetryTimer, qaPhase]);

  // Dynamic followup: retry while pitch transcript is not ready.
  useEffect(() => {
    if (!canAttemptDynamicFollowupPhase(qaPhase)) {
      clearDynamicFollowupRetryTimer();
      return;
    }

    if (questions.some(isDynamicFollowupQuestion)) {
      dynamicFollowupCompletedRef.current = true;
      clearDynamicFollowupRetryTimer();
      return;
    }

    if (
      !dynamicFollowupExperiment ||
      !isGuardResolved ||
      questions.length === 0 ||
      dynamicFollowupCompletedRef.current ||
      dynamicFollowupInFlightRef.current ||
      dynamicFollowupRetryTimerRef.current !== null
    ) {
      return;
    }

    const protectedQuestionIds = questions
      .filter(
        (question) =>
          question.answer?.revealedQuestionText ||
          question.answer?.startedAt ||
          question.answer?.endedAt,
      )
      .map((question) => question.id);

    devLog("[dynamic-followup:client] request started", {
      sessionId,
      questionsCount: questions.length,
      protectedCount: protectedQuestionIds.length,
      retryCount: dynamicFollowupRetryCountRef.current,
    });

    dynamicFollowupInFlightRef.current = true;

    void (async () => {
      try {
        const response = await fetch(
          `/training/${sessionId}/qa/questions/dynamic-followup`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              protectedQuestionIds,
              minReplaceableOrderIndex: 1,
            }),
          },
        );

        if (!canAttemptDynamicFollowupPhase(qaPhaseRef.current)) {
          devLog("[dynamic-followup:client] ignored after phase changed", {
            sessionId,
            qaPhase: qaPhaseRef.current,
          });
          return;
        }

        if (!response.ok) {
          devLog("[dynamic-followup:client] request failed", {
            sessionId,
            status: response.status,
            retryCount: dynamicFollowupRetryCountRef.current,
          });
          scheduleDynamicFollowupRetry(`http_${response.status}`);
          return;
        }

        const body = (await response.json()) as {
          ok: boolean;
          skipped?: boolean;
          reason?: string;
          createdQuestion?: TrainingQaQuestion;
          createdQuestionId?: string;
          questionText?: string;
          source?: string;
        };

        if (body.ok && body.createdQuestion) {
          dynamicFollowupCompletedRef.current = true;
          clearDynamicFollowupRetryTimer();

          devLog("[dynamic-followup:client] appended dynamic question", {
            sessionId,
            createdQuestionId:
              body.createdQuestionId ?? body.createdQuestion.id,
          });

          if (canAttemptDynamicFollowupPhase(qaPhaseRef.current)) {
            setQuestions((currentQuestions) => {
              const hasDynamicQuestion = currentQuestions.some(
                (question) =>
                  question.id === body.createdQuestion!.id ||
                  (question.orderIndex === body.createdQuestion!.orderIndex &&
                    question.source === "DYNAMIC_FOLLOWUP"),
              );

              if (hasDynamicQuestion) {
                return currentQuestions;
              }

              return [...currentQuestions, body.createdQuestion!].sort(
                (first, second) => first.orderIndex - second.orderIndex,
              );
            });
          }
        } else {
          const reason = body.reason ?? "unknown";
          devLog("[dynamic-followup:client] skipped", {
            sessionId,
            reason,
            retryCount: dynamicFollowupRetryCountRef.current,
          });

          if (body.skipped && isTranscriptNotReadyReason(reason)) {
            scheduleDynamicFollowupRetry(reason);
            return;
          }

          dynamicFollowupCompletedRef.current = true;
          clearDynamicFollowupRetryTimer();
        }
      } catch (error) {
        devLog("[dynamic-followup:client] error", {
          sessionId,
          error: String(error),
          retryCount: dynamicFollowupRetryCountRef.current,
        });
        scheduleDynamicFollowupRetry("network_error");
      } finally {
        dynamicFollowupInFlightRef.current = false;
      }
    })();
  }, [
    clearDynamicFollowupRetryTimer,
    dynamicFollowupExperiment,
    dynamicFollowupRetryTick,
    isGuardResolved,
    qaPhase,
    questions,
    scheduleDynamicFollowupRetry,
    sessionId,
  ]);

  useEffect(() => {
    const header = document.querySelector("header");
    if (!header) return;
    const originalDisplay = header.style.display;
    header.style.display = "none";
    return () => {
      header.style.display = originalDisplay;
    };
  }, []);

  // 拦截浏览器返回：push 哨兵状态，返回时按中止训练处理
  useEffect(() => {
    const sentinelKey = `qa-sentinel-${sessionId}`;
    let aborted = false;

    const handleAbort = () => {
      if (aborted || isCompletingNormallyRef.current) return;
      aborted = true;
      void (async () => {
        try {
          await fetch(`/training/${sessionId}/abort`, { method: "POST" });
        } finally {
          router.replace(`/training/${sessionId}/report`);
        }
      })();
    };

    const handlePopState = () => {
      handleAbort();
    };

    history.pushState({ [sentinelKey]: true }, "", window.location.href);
    window.addEventListener("popstate", handlePopState);

    return () => {
      window.removeEventListener("popstate", handlePopState);
    };
  }, [sessionId, router, isCompletingNormallyRef]);

  useEffect(() => {
    const originalOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = originalOverflow;
    };
  }, []);

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

  const shouldShowMessageToast =
    Boolean(message) &&
    !questionTextDialog &&
    message !== "答辩问题已生成。开始前不会展示完整题目。" &&
    message !== "评委问题生成时间较长，请稍候……" &&
    message !== speechUnavailableMessage;

  const changeMaterialPage = useCallback(
    (direction: "PREV" | "NEXT") => {
      if (!previewFile) {
        return;
      }

      setPageIndex((currentIndex) => {
        const nextIndex =
          direction === "NEXT" ? currentIndex + 1 : currentIndex - 1;
        const maxIndex = totalPages !== null ? totalPages - 1 : currentIndex + 1;

        return Math.min(Math.max(nextIndex, 0), Math.max(0, maxIndex));
      });
    },
    [previewFile, totalPages],
  );

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

  useEffect(() => {
    if (!previewFile || !previewUrl) {
      window.queueMicrotask(() => {
        setPdfDocument(null);
        setTotalPages(null);
        setIsPdfLoading(false);
        setPdfError("");
      });
      return;
    }

    const pdfUrl: string = previewUrl;
    let isCancelled = false;
    let loadingTask: PDFDocumentLoadingTask | null = null;

    async function loadPdf() {
      setIsPdfLoading(true);
      setPdfError("");

      try {
        const pdfjs = await import("pdfjs-dist");

        pdfjs.GlobalWorkerOptions.workerSrc = pdfWorkerSrc;
        loadingTask = pdfjs.getDocument({
          url: pdfUrl,
          cMapUrl: pdfCMapUrl,
          cMapPacked: true,
          standardFontDataUrl: pdfStandardFontDataUrl,
          wasmUrl: pdfWasmUrl,
          iccUrl: pdfIccUrl,
        });

        const loadedDocument = await loadingTask.promise;

        if (!isCancelled) {
          setPdfDocument(loadedDocument);
          setTotalPages(loadedDocument.numPages);
          setPageIndex((currentIndex) =>
            Math.min(Math.max(currentIndex, 0), loadedDocument.numPages - 1),
          );
        }
      } catch (error) {
        if (!isCancelled) {
          setPdfDocument(null);
          setTotalPages(null);
          setPdfError(
            error instanceof Error ? error.message : "PDF 材料加载失败。",
          );
        }
      } finally {
        if (!isCancelled) {
          setIsPdfLoading(false);
        }
      }
    }

    void loadPdf();

    return () => {
      isCancelled = true;
      void loadingTask?.destroy();
    };
  }, [previewFile, previewUrl]);

  useEffect(() => {
    if (!pdfDocument || !canvasRef.current) {
      return;
    }

    const loadedDocument: PDFDocumentProxy = pdfDocument;
    let isCancelled = false;
    let renderTask: RenderTask | null = null;
    const canvas = canvasRef.current;
    const container = previewContainerRef.current;

    async function renderPage() {
      try {
        const page = await loadedDocument.getPage(currentPageNumber);

        if (isCancelled) {
          return;
        }

        const baseViewport = page.getViewport({ scale: 1 });
        const availableWidth = container?.clientWidth ?? baseViewport.width;
        const availableHeight = container?.clientHeight ?? baseViewport.height;
        const scaleByWidth = Math.max(0.1, (availableWidth - 32) / baseViewport.width);
        const scaleByHeight = Math.max(
          0.1,
          (availableHeight - 32) / baseViewport.height,
        );
        const cssScale = Math.min(scaleByWidth, scaleByHeight);
        const viewport = page.getViewport({ scale: cssScale });
        const context = canvas.getContext("2d");

        if (!context) {
          throw new Error("当前浏览器不支持 Canvas 渲染。");
        }

        const outputScale = window.devicePixelRatio || 1;

        canvas.width = Math.floor(viewport.width * outputScale);
        canvas.height = Math.floor(viewport.height * outputScale);
        canvas.style.width = `${Math.floor(viewport.width)}px`;
        canvas.style.height = `${Math.floor(viewport.height)}px`;
        context.setTransform(outputScale, 0, 0, outputScale, 0, 0);
        renderTask = page.render({
          canvas,
          canvasContext: context,
          viewport,
        });
        await renderTask.promise;
      } catch (error) {
        if (!isCancelled && error instanceof Error && error.name !== "RenderingCancelledException") {
          setPdfError(error.message);
        }
      }
    }

    void renderPage();

    return () => {
      isCancelled = true;
      renderTask?.cancel();
    };
  }, [currentPageNumber, pdfDocument]);

  useEffect(() => {
    const container = previewContainerRef.current;

    if (!container || !previewFile) {
      return;
    }

    const observer = new ResizeObserver(() => {
      setPageIndex((currentIndex) => currentIndex);
    });

    observer.observe(container);

    return () => observer.disconnect();
  }, [previewFile]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (isEditableOrClickableTarget(event.target)) {
        return;
      }

      if (["ArrowRight", "PageDown", " ", "Enter"].includes(event.key)) {
        event.preventDefault();
        changeMaterialPage("NEXT");
        return;
      }

      if (["ArrowLeft", "PageUp", "Backspace"].includes(event.key)) {
        event.preventDefault();
        changeMaterialPage("PREV");
      }
    };

    window.addEventListener("keydown", handleKeyDown);

    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [changeMaterialPage]);

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
            qaDurationSec: getCurrentUsedAnswerSec(),
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
      getCurrentUsedAnswerSec,
      revealedQuestionIds,
      router,
      sessionId,
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
        void finishQaWithCurrentQuestion(currentQuestion);
      }
    }, 500);

    return () => window.clearInterval(timer);
  }, [currentQuestion, finishQaWithCurrentQuestion, isQaing, qaPhase]);

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

  // 自动生成 QA 问题：轮询 GET → POST 一次 → 等待 → 超时
  useEffect(() => {
    if (!isGuardResolved) return;
    if (questions.length > 0) {
      devLog("[qa:client] questions already loaded, skipping auto-generate", {
        count: questions.length,
      });
      return;
    }
    if (autoGenerateRef.current) return;
    autoGenerateRef.current = true;

    devLog("[qa:client] starting auto-generation", {
      sessionId,
      initialQuestionsCount: 0,
    });

    const startTime = Date.now();
    const MAX_WAIT_MS = dynamicFollowupExperiment ? 120_000 : 60_000;
    const POLL_INTERVAL_MS = 3_000;
    let pollTimer: ReturnType<typeof setInterval> | null = null;
    let postAttempted = false;
    let aborted = false;

    setIsGenerating(true);

    const stop = (errorMsg?: string) => {
      aborted = true;
      if (pollTimer !== null) {
        clearInterval(pollTimer);
        pollTimer = null;
      }
      if (errorMsg) {
        setMessage(errorMsg);
      }
      setIsGenerating(false);
    };

    const poll = async () => {
      if (aborted) return;
      const elapsed = Date.now() - startTime;

      // 硬超时 60 秒
      if (elapsed >= MAX_WAIT_MS) {
        devLog("[qa:client] generation timed out", {
          sessionId,
          elapsed: `${Math.round(elapsed / 1000)}s`,
        });
        stop("问题生成时间较长，可重试。");
        return;
      }

      try {
        // 步骤 1: GET 检查当前状态
        const getRes = await fetch(
          `/training/${sessionId}/qa/questions/generate`,
        );
        const getBody = (await getRes.json().catch(() => null)) as {
          questions?: TrainingQaQuestion[];
          isGenerating?: boolean;
          error?: string;
        } | null;

        devLog("[qa:client] GET response", {
          sessionId,
          elapsed: `${Math.round((Date.now() - startTime) / 1000)}s`,
          questionsCount: getBody?.questions?.length ?? 0,
          isGenerating: getBody?.isGenerating ?? false,
          error: getBody?.error ?? null,
        });

        // 已有问题 → 直接展示
        if (getBody?.questions?.length) {
          devLog("[qa:client] questions found, displaying", {
            count: getBody.questions.length,
          });
          setQuestions(getBody.questions);
          setCurrentQuestionIndex(0);
          setMessage("答辩问题已生成。开始前不会展示完整题目。");
          stop();
          return;
        }

        // 正在生成 → 继续等待
        if (getBody?.isGenerating) {
          // 已达 30 秒提示用户
          if (elapsed >= 30_000) {
            setMessage("评委问题生成时间较长，请稍候……");
          }
          return;
        }

        // 步骤 2: 没有 questions 且不在生成中 → 首次尝试 POST
        if (!postAttempted) {
          postAttempted = true;

          devLog("[qa:client] POST generating questions", { sessionId });
          const postRes = await fetch(
            `/training/${sessionId}/qa/questions/generate`,
            { method: "POST" },
          );
          const postBody = (await postRes.json().catch(() => null)) as {
            questions?: TrainingQaQuestion[];
            error?: string;
            generating?: boolean;
            lockAgeMs?: number;
            message?: string;
          } | null;

          devLog("[qa:client] POST response", {
            sessionId,
            status: postRes.status,
            ok: postRes.ok,
            questionsCount: postBody?.questions?.length ?? 0,
            generating: postBody?.generating ?? false,
            error: postBody?.error ?? null,
          });

          // POST 成功
          if (postRes.ok && postBody?.questions?.length) {
            setQuestions(postBody.questions);
            setCurrentQuestionIndex(0);
            setMessage("答辩问题已生成。开始前不会展示完整题目。");
            stop();
            return;
          }

          // POST 409: 正在生成中（锁存在），切换到轮询等待
          if (postRes.status === 409) {
            setMessage(
              postBody?.message ?? "评委问题准备中，请稍候……",
            );
            return;
          }

          // POST 其他错误: 显示错误并停止
          stop(postBody?.error ?? "问题生成失败，请重试。");
          return;
        }
      } catch {
        // 网络错误，继续轮询（可能是暂时的）
        devLog("[qa:client] network error during poll, will retry", {
          sessionId,
        });
      }
    };

    // 首次立即轮询
    poll();
    pollTimer = setInterval(poll, POLL_INTERVAL_MS);

    return () => {
      aborted = true;
      if (pollTimer !== null) {
        clearInterval(pollTimer);
      }
    };
  }, [isGuardResolved, questions.length, sessionId, dynamicFollowupExperiment]);

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

  async function saveAndContinue() {
    if (!currentQuestion || qaPhase !== "ANSWERING") {
      return;
    }

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
            qaDurationSec: currentUsedAnswerSec,
            finish: shouldFinishAfterCurrent,
          }),
        },
      );
      const body = (await response.json().catch(() => null)) as {
        completed?: boolean;
        nextQuestionId?: string;
        error?: string;
      } | null;

      if (!response.ok) {
        throw new Error(body?.error ?? "保存本题回答失败。");
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
  const mainButtonLabel = shouldFinishAfterCurrent
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
                onClick={() => void saveAndContinue()}
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
