"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { devLog, devWarn } from "@/lib/dev-log";
import { useTrainingAbortGuard } from "@/lib/use-training-abort-guard";
import { getTrainingFlowPath } from "@/lib/training-status";
import {
  usePitchPdfPreview,
  type PreviewNotice,
  type TrainingFile,
} from "@/lib/use-pitch-pdf-preview";
import { useFullscreenMode } from "@/lib/use-fullscreen-mode";
import {
  usePitchRecording,
  type RecordingStatus,
  type TrainingRecording,
} from "@/lib/use-pitch-recording";
import { usePitchTranscript } from "@/lib/use-pitch-transcript";
import {
  usePitchAnalysis,
  type TrainingAnalysis,
} from "@/lib/use-pitch-analysis";
import { TrainingPitchSidebar } from "./training-session/training-pitch-sidebar";
import { TrainingPitchStage } from "./training-session/training-pitch-stage";
import { TrainingRecordingDialogs } from "./training-session/training-recording-dialogs";
import { TrainingSessionOverlays } from "./training-session/training-session-overlays";

type TrainingSessionClientProps = Readonly<{
  sessionId: string;
  projectName: string;
  initialStatus: string;
  initialPageIndex: number;
  initialPitchStartedAt: string | null;
  initialElapsedSec: number;
  initialRemainingSec: number;
  initialPitchDurationSec: number | null;
  previewFile: TrainingFile | null;
  previewNotice: PreviewNotice | null;
  initialRecording: TrainingRecording | null;
  initialAnalysis: TrainingAnalysis | null;
  autoStartRecordingOnMount?: boolean;
  redirectToQaAfterPitchEnd?: boolean;
  showAnalysisPanel?: boolean;
}>;

const pitchLimitSec = 9 * 60;

function getElapsedSec(startedAt: string | null, fallback: number) {
  if (!startedAt) {
    return fallback;
  }

  return Math.max(
    0,
    Math.floor((Date.now() - new Date(startedAt).getTime()) / 1000),
  );
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

export function TrainingSessionClient({
  sessionId,
  projectName,
  initialStatus,
  initialPageIndex,
  initialPitchStartedAt,
  initialElapsedSec,
  initialRemainingSec,
  initialPitchDurationSec,
  previewFile,
  previewNotice,
  initialRecording,
  initialAnalysis,
  autoStartRecordingOnMount = false,
  redirectToQaAfterPitchEnd = false,
  showAnalysisPanel = true,
}: TrainingSessionClientProps) {
  const router = useRouter();
  const [status, setStatus] = useState(initialStatus);
  const [pageIndex, setPageIndex] = useState(initialPageIndex);
  const [pitchStartedAt, setPitchStartedAt] = useState(initialPitchStartedAt);
  const [elapsedSec, setElapsedSec] = useState(
    initialPitchDurationSec ?? initialElapsedSec,
  );
  const [remainingSec, setRemainingSec] = useState(initialRemainingSec);
  const [message, setMessage] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isGuardResolved, setIsGuardResolved] = useState(false);
  const [prepCountdown, setPrepCountdown] = useState<number | null>(null);
  const prepCountdownIntervalRef = useRef<number | null>(null);
  const hasAutoEndedPitchRef = useRef(false);
  const isCompletingNormallyRef = useRef(false);
  const isPitching = status === "PITCHING";
  const isEnded = status === "PITCH_ENDED" || status === "FINISHED";
  const {
    transcript,
    transcriptDraft,
    setTranscriptDraft,
    isTranscriptEditing,
    setIsTranscriptEditing,
    isTranscriptSaving,
    transcriptMessage,
    setTranscriptMessage,
    transcribeStatus,
    transcribeErrorMessage,
    saveTranscript,
    triggerTranscribe,
    resetTranscriptAfterRecordingSaved,
  } = usePitchTranscript({
    sessionId,
    recordingId: initialRecording?.id ?? "",
    initialTranscript: initialRecording?.transcript ?? null,
  });
  const { analysis, isAnalysisLoading, analysisMessage, generateAnalysis } =
    usePitchAnalysis({
      sessionId,
      isEnded,
      transcript,
      transcribeStatus,
      initialAnalysis,
    });
  const {
    recordingStatus,
    recordingMessage,
    recordingId,
    recordingPlaybackUrl,
    showRecordingPrepDialog,
    showRecordingOptOutConfirm,
    showRecordingReenableConfirm,
    prepareRecording,
    confirmRecordingOptOut,
    stopRecordingAndUpload,
    isRecordingActive,
    openRecordingPrepDialog,
    openRecordingOptOutConfirm,
    closeRecordingOptOutConfirm,
    openRecordingReenableConfirm,
    closeRecordingReenableConfirm,
    reenableRecording,
    handlePitchStartedRecording,
    handlePitchEndedWithoutRecording,
    markTranscribePreparing,
  } = usePitchRecording({
    sessionId,
    initialStatus,
    initialRecording,
    autoStartRecordingOnMount,
    isPitching,
    isGuardResolved,
    onRecordingSaved: resetTranscriptAfterRecordingSaved,
  });
  const requestPdfRenderRef = useRef<() => void>(() => {});
  const handleFullscreenLayoutChanged = useCallback(() => {
    requestPdfRenderRef.current();
  }, []);
  const {
    containerRef: trainingShellRef,
    isBigScreenMode,
    fullscreenMessage,
    enterBigScreen,
  } = useFullscreenMode({
    initialBigScreenMode: initialStatus === "PITCHING",
    onLayoutChanged: handleFullscreenLayoutChanged,
  });
  const handlePdfDocumentLoaded = useCallback((loadedTotalPages: number) => {
    setPageIndex((currentIndex) =>
      Math.min(Math.max(currentIndex, 0), loadedTotalPages - 1),
    );
  }, []);
  const handlePdfPageChange = useCallback((nextPageIndex: number) => {
    setPageIndex(nextPageIndex);
  }, []);
  const handlePdfSubmittingChange = useCallback((submitting: boolean) => {
    setIsSubmitting(submitting);
  }, []);
  const handlePdfPageChangeStart = useCallback(() => {
    setMessage("");
  }, []);
  const handlePdfError = useCallback((errorMessage: string) => {
    setMessage(errorMessage);
  }, []);
  const {
    canvasRef,
    previewContainerRef,
    compatiblePreviewUrl,
    primaryFileId,
    currentPageNumber,
    pageLabel,
    canGoPrev,
    canGoNext,
    pdfError,
    isPdfLoading,
    previewMode,
    setPreviewMode,
    changePage,
    requestRender: requestPdfRender,
  } = usePitchPdfPreview({
    sessionId,
    previewFile,
    pageIndex,
    elapsedSec,
    isPitching,
    isSubmitting,
    isBigScreenMode,
    onDocumentLoaded: handlePdfDocumentLoaded,
    onPageChange: handlePdfPageChange,
    onSubmittingChange: handlePdfSubmittingChange,
    onPageChangeStart: handlePdfPageChangeStart,
    onError: handlePdfError,
  });
  useEffect(() => {
    requestPdfRenderRef.current = requestPdfRender;
  }, [requestPdfRender]);
  const statusLabel = useMemo(() => {
    const labels: Record<string, string> = {
      CREATED: "待开始",
      PITCH_READY: "路演准备中",
      PITCHING: "路演中",
      PITCH_ENDED: "路演已结束",
      QA_READY: "答辩准备中",
      QAING: "答辩中",
      QA_ENDED: "答辩已完成",
      REPORT_READY: "报告准备中",
      FINISHED: "已完成",
      ABORTED: "已中止",
    };

    return labels[status] ?? status;
  }, [status]);
  const statusHint = useMemo(() => {
    if (status === "CREATED") {
      return "预览中，开始路演后将自动从第 1 页计时。";
    }

    if (isPitching) {
      return "路演中";
    }

    if (isEnded) {
      return "路演已结束";
    }

    return statusLabel;
  }, [isEnded, isPitching, status, statusLabel]);
  const recordingStatusLabel = useMemo(() => {
    const labels: Record<RecordingStatus, string> = {
      UNDECIDED: "未选择是否录音",
      READY_TO_RECORD: "麦克风已就绪",
      OPTED_OUT: "本轮未启用录音",
      RECORDING: "录音中",
      SAVING: "录音保存中",
      SAVED: "录音已保存",
      FAILED: "录音失败",
      UNSUPPORTED: "浏览器不支持录音",
      PERMISSION_DENIED: "麦克风权限未开启",
    };

    return labels[recordingStatus];
  }, [recordingStatus]);

  useTrainingAbortGuard({
    sessionId,
    enabled: isPitching,
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

  // BFCache 恢复 / 页面重新可见时校验状态，若已不在 pitch 阶段则跳转
  useEffect(() => {
    async function verifyStatus() {
      try {
        const res = await fetch(`/training/${sessionId}/status`);
        if (!res.ok) return;
        const body = (await res.json()) as { status?: string };
        if (!body.status || body.status === "PITCHING") return;
        isCompletingNormallyRef.current = true;
        router.replace(getTrainingFlowPath(sessionId, body.status));
      } catch {
        // 网络错误时不跳转，避免误伤正常训练
      }
    }

    const handlePageShow = (e: PageTransitionEvent) => {
      if (e.persisted) verifyStatus();
    };

    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") verifyStatus();
    };

    window.addEventListener("pageshow", handlePageShow);
    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => {
      window.removeEventListener("pageshow", handlePageShow);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [sessionId, router, isCompletingNormallyRef]);

  // 拦截浏览器返回：pitch 阶段 push 哨兵，返回时按中止训练处理
  useEffect(() => {
    if (!isPitching) return;

    const sentinelKey = `pitch-sentinel-${sessionId}`;
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
  }, [isPitching, sessionId, router, isCompletingNormallyRef]);

  useEffect(() => {
    const isActiveStatus = initialStatus === "PITCHING";
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

  useEffect(() => {
    if (!isPitching || !isGuardResolved) {
      return;
    }

    const updateTimer = () => {
      const nextElapsedSec = getElapsedSec(pitchStartedAt, 0);

      setElapsedSec(nextElapsedSec);
      setRemainingSec(Math.max(0, pitchLimitSec - nextElapsedSec));
    };

    updateTimer();

    const timer = window.setInterval(() => {
      updateTimer();
    }, 1000);

    return () => window.clearInterval(timer);
  }, [isGuardResolved, isPitching, pitchStartedAt]);

  // pitch 页面挂载兜底：如果 questions 尚未预生成，fire-and-forget 触发一次
  const qaFallbackTriggeredRef = useRef(false);
  useEffect(() => {
    if (!isPitching) return;
    if (!isGuardResolved) return;
    if (qaFallbackTriggeredRef.current) return;
    qaFallbackTriggeredRef.current = true;

    devLog("[pitch:mounted] pre-generate QA fallback started", {
      sessionId,
    });

    // 先 GET 检查是否已有 questions
    fetch(`/training/${sessionId}/qa/questions/generate`)
      .then(async (getRes) => {
        const getBody = (await getRes.json().catch(() => null)) as {
          questions?: Array<unknown>;
          isGenerating?: boolean;
        } | null;

        // 已有 questions，无需预生成
        if (getBody?.questions?.length) {
          devLog("[pitch:mounted] QA questions already exist", {
            sessionId,
            count: getBody.questions.length,
          });
          return;
        }

        // 正在生成中，无需重复触发
        if (getBody?.isGenerating) {
          devLog("[pitch:mounted] QA generation already in progress", {
            sessionId,
          });
          return;
        }

        // 触发 POST 生成
        return fetch(`/training/${sessionId}/qa/questions/generate`, {
          method: "POST",
          keepalive: true,
        });
      })
      .then(async (postRes) => {
        if (!postRes) return; // 前面的 early return
        const body = await postRes.json().catch(() => null);
        devLog("[pitch:mounted] pre-generate QA fallback response", {
          sessionId,
          status: postRes.status,
          ok: postRes.ok,
          questionsCount: body?.questions?.length ?? 0,
          generating: body?.generating ?? false,
          error: body?.error ?? null,
        });
      })
      .catch((err) => {
        devWarn("[pitch:mounted] pre-generate QA fallback failed", {
          sessionId,
          error: err instanceof Error ? err.message : String(err),
        });
      });
  }, [isPitching, isGuardResolved, sessionId]);

  useEffect(() => {
    return () => {
      if (prepCountdownIntervalRef.current !== null) {
        window.clearInterval(prepCountdownIntervalRef.current);
        prepCountdownIntervalRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (isEditableOrClickableTarget(event.target)) {
        return;
      }

      if (
        event.key === "ArrowLeft" ||
        event.key === "PageUp" ||
        event.key === "Backspace"
      ) {
        event.preventDefault();
        void changePage("PREV");
      }

      if (
        event.key === "ArrowRight" ||
        event.key === "PageDown" ||
        event.key === " " ||
        event.key === "Spacebar" ||
        event.key === "Enter"
      ) {
        event.preventDefault();
        void changePage("NEXT");
      }
    };

    window.addEventListener("keydown", handleKeyDown);

    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [changePage]);

  // eslint-disable-next-line @typescript-eslint/no-unused-vars -- kept for future use
  function beginPrepCountdown() {
    if (status === "CREATED" && recordingStatus === "UNDECIDED") {
      openRecordingPrepDialog();
      setMessage("请先开启麦克风，或明确选择暂不录音后再开始路演。");
      return;
    }

    setIsSubmitting(true);
    setMessage("");
    setPrepCountdown(4);

    prepCountdownIntervalRef.current = window.setInterval(() => {
      setPrepCountdown((prev) => {
        if (prev === null || prev <= 0) {
          if (prepCountdownIntervalRef.current !== null) {
            window.clearInterval(prepCountdownIntervalRef.current);
            prepCountdownIntervalRef.current = null;
          }
          return null;
        }
        const next = prev - 1;
        if (next <= 0) {
          if (prepCountdownIntervalRef.current !== null) {
            window.clearInterval(prepCountdownIntervalRef.current);
            prepCountdownIntervalRef.current = null;
          }
          void startPitch();
          return null;
        }
        return next;
      });
    }, 1000);
  }

  async function startPitch() {
    if (status === "CREATED" && recordingStatus === "UNDECIDED") {
      openRecordingPrepDialog();
      setMessage("请先开启麦克风，或明确选择暂不录音后再开始路演。");
      return;
    }

    setIsSubmitting(true);
    setMessage("");
    void enterBigScreen();

    try {
      const response = await fetch(`/training/${sessionId}/start-pitch`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          fileId: primaryFileId,
        }),
      });

      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as {
          error?: string;
        } | null;

        throw new Error(body?.error ?? "开始路演失败。");
      }

      const body = (await response.json()) as {
        session: {
          status: string;
          pitchStartedAt: string;
          currentPageIndex: number;
        };
      };

      setStatus(body.session.status);
      setPitchStartedAt(body.session.pitchStartedAt);
      setPageIndex(Math.max(0, body.session.currentPageIndex - 1));
      setElapsedSec(0);
      setRemainingSec(pitchLimitSec);
      handlePitchStartedRecording();

      // 后台预生成 QA 答辩问题，不阻塞路演
      devLog("[startPitch] pre-generate QA started", {
        sessionId,
        url: `/training/${sessionId}/qa/questions/generate`,
        timestamp: Date.now(),
      });
      fetch(`/training/${sessionId}/qa/questions/generate`, {
        method: "POST",
        keepalive: true,
      })
        .then(async (res) => {
          const body = await res.json().catch(() => null);
          devLog("[startPitch] pre-generate QA response", {
            sessionId,
            status: res.status,
            ok: res.ok,
            questionsCount: body?.questions?.length ?? 0,
            error: body?.error ?? null,
          });
        })
        .catch((err) => {
          devWarn("[startPitch] pre-generate QA failed", {
            sessionId,
            error: err instanceof Error ? err.message : String(err),
          });
        });
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "开始路演失败。");
    } finally {
      setIsSubmitting(false);
    }
  }

  const endPitch = useCallback(async () => {
    setIsSubmitting(true);
    setMessage("");
    const shouldUploadRecording = isRecordingActive();

    try {
      const response = await fetch(`/training/${sessionId}/end-pitch`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          pitchDurationSec: elapsedSec,
          pageIndex: currentPageNumber,
          fileId: primaryFileId,
        }),
      });

      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as {
          error?: string;
        } | null;

        throw new Error(body?.error ?? "结束路演失败。");
      }

      const body = (await response.json()) as {
        session: {
          status: string;
          pitchDurationSec: number;
          currentPageIndex: number;
        };
      };

      setStatus(body.session.status);
      setPageIndex(Math.max(0, body.session.currentPageIndex - 1));
      setElapsedSec(body.session.pitchDurationSec);
      setRemainingSec(
        Math.max(0, pitchLimitSec - body.session.pitchDurationSec),
      );

      let savedPitchRecordingId: string | undefined;

      if (shouldUploadRecording) {
        const savedRecordingId = await stopRecordingAndUpload();

        if (savedRecordingId) {
          savedPitchRecordingId = savedRecordingId;
          // 启动后台转写，不等待真实 ASR 完成。
          await triggerTranscribe(savedRecordingId);
          markTranscribePreparing();
        }
      }

      if (!shouldUploadRecording) {
        handlePitchEndedWithoutRecording();
      }

      if (redirectToQaAfterPitchEnd) {
        isCompletingNormallyRef.current = true;
        const nextUrl = savedPitchRecordingId
          ? `/training/${sessionId}/qa-prepare?recordingId=${encodeURIComponent(savedPitchRecordingId)}`
          : `/training/${sessionId}/qa-prepare`;
        router.replace(nextUrl);
      }
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "结束路演失败。");
    } finally {
      setIsSubmitting(false);
    }
  }, [
    currentPageNumber,
    elapsedSec,
    handlePitchEndedWithoutRecording,
    isRecordingActive,
    markTranscribePreparing,
    primaryFileId,
    redirectToQaAfterPitchEnd,
    router,
    sessionId,
    stopRecordingAndUpload,
    triggerTranscribe,
  ]);

  useEffect(() => {
    if (!isPitching || remainingSec > 0 || hasAutoEndedPitchRef.current) {
      return;
    }

    hasAutoEndedPitchRef.current = true;
    void endPitch();
  }, [endPitch, isPitching, remainingSec]);

  const handleStartTranscriptEditing = useCallback(() => {
    if (!transcript) {
      return;
    }

    setTranscriptDraft(transcript.text);
    setIsTranscriptEditing(true);
    setTranscriptMessage("");
  }, [
    setIsTranscriptEditing,
    setTranscriptDraft,
    setTranscriptMessage,
    transcript,
  ]);

  const handleCancelTranscriptEditing = useCallback(() => {
    if (!transcript) {
      return;
    }

    setTranscriptDraft(transcript.text);
    setIsTranscriptEditing(false);
    setTranscriptMessage("");
  }, [
    setIsTranscriptEditing,
    setTranscriptDraft,
    setTranscriptMessage,
    transcript,
  ]);

  const shellClassName = isBigScreenMode
    ? "fixed inset-0 z-50 grid h-screen w-screen gap-3 overflow-hidden bg-slate-950 p-3 text-white"
    : "grid gap-5 lg:grid-cols-[minmax(0,1fr)_320px]";

  return (
    <>
      <TrainingSessionOverlays
        isGuardResolved={isGuardResolved}
        prepCountdown={prepCountdown}
      />
      <div ref={trainingShellRef} className={shellClassName}>
        <TrainingPitchStage
          projectName={projectName}
          status={status}
          statusLabel={statusLabel}
          statusHint={statusHint}
          recordingStatus={recordingStatus}
          recordingStatusLabel={recordingStatusLabel}
          remainingSec={remainingSec}
          pageLabel={pageLabel}
          message={message}
          fullscreenMessage={fullscreenMessage}
          previewFile={previewFile}
          previewNotice={previewNotice}
          compatiblePreviewUrl={compatiblePreviewUrl}
          previewMode={previewMode}
          previewContainerRef={previewContainerRef}
          canvasRef={canvasRef}
          isPdfLoading={isPdfLoading}
          pdfError={pdfError}
          currentPageNumber={currentPageNumber}
          isBigScreenMode={isBigScreenMode}
          isSubmitting={isSubmitting}
          isPitching={isPitching}
          canGoPrev={canGoPrev}
          canGoNext={canGoNext}
          onPreviewModeChange={setPreviewMode}
          onOpenRecordingReenableConfirm={openRecordingReenableConfirm}
          onPrepareRecording={prepareRecording}
          onEndPitch={endPitch}
          onChangePage={changePage}
        />

        {!isBigScreenMode ? (
          <TrainingPitchSidebar
            elapsedSec={elapsedSec}
            pageLabel={pageLabel}
            recordingStatus={recordingStatus}
            recordingStatusLabel={recordingStatusLabel}
            recordingMessage={recordingMessage}
            recordingPlaybackUrl={recordingPlaybackUrl}
            recordingId={recordingId}
            isEnded={isEnded}
            transcript={transcript}
            transcriptDraft={transcriptDraft}
            isTranscriptEditing={isTranscriptEditing}
            isTranscriptSaving={isTranscriptSaving}
            transcriptMessage={transcriptMessage}
            transcribeStatus={transcribeStatus}
            transcribeErrorMessage={transcribeErrorMessage}
            showAnalysisPanel={showAnalysisPanel}
            analysis={analysis}
            analysisMessage={analysisMessage}
            isAnalysisLoading={isAnalysisLoading}
            onRetryTranscribe={triggerTranscribe}
            onStartTranscriptEditing={handleStartTranscriptEditing}
            onCancelTranscriptEditing={handleCancelTranscriptEditing}
            onTranscriptDraftChange={setTranscriptDraft}
            onSaveTranscript={saveTranscript}
            onGenerateAnalysis={generateAnalysis}
          />
        ) : null}

        <TrainingRecordingDialogs
          status={status}
          recordingMessage={recordingMessage}
          showRecordingPrepDialog={showRecordingPrepDialog}
          showRecordingOptOutConfirm={showRecordingOptOutConfirm}
          showRecordingReenableConfirm={showRecordingReenableConfirm}
          onOpenRecordingOptOutConfirm={openRecordingOptOutConfirm}
          onCloseRecordingOptOutConfirm={closeRecordingOptOutConfirm}
          onConfirmRecordingOptOut={confirmRecordingOptOut}
          onPrepareRecording={prepareRecording}
          onCloseRecordingReenableConfirm={closeRecordingReenableConfirm}
          onReenableRecording={reenableRecording}
        />
      </div>
    </>
  );
}
