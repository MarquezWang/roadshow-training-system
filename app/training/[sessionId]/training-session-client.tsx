"use client";

import { useRouter } from "next/navigation";
import type {
  PDFDocumentLoadingTask,
  PDFDocumentProxy,
  RenderTask,
} from "pdfjs-dist";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTrainingAbortGuard } from "@/lib/use-training-abort-guard";
import { getTrainingFlowPath } from "@/lib/training-status";

type TrainingFile = {
  id: string;
  originalName: string;
  fileType: string;
};

type TrainingTranscript = {
  id: string;
  recordingId: string;
  sessionId: string;
  status: string;
  source: string;
  language: string;
  text: string;
  segmentsJson: string | null;
  errorMessage: string | null;
  startedAt: string | null;
  completedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

type TrainingRecording = {
  id: string;
  phase: string;
  status: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  durationSec: number | null;
  startedAt: string | null;
  endedAt: string | null;
  playbackUrl: string;
  transcript: TrainingTranscript | null;
};

type TrainingCoverageItem = {
  item: string;
  covered: "true" | "false" | "partial";
  evidence: string;
  suggestion: string;
};

type TrainingAnalysis = {
  id: string;
  sessionId: string;
  projectId: string;
  transcriptId: string | null;
  status: string;
  analysisType: string;
  durationSec: number;
  pageCount: number | null;
  slideEventCount: number | null;
  overallScore: number | null;
  summary: string;
  strengths: string[];
  weaknesses: string[];
  suggestions: string[];
  coverage: TrainingCoverageItem[];
  timing: Record<string, unknown>;
  slideSync: Record<string, unknown>;
  riskQuestions: string[];
  errorMessage: string | null;
  createdAt: string;
  updatedAt: string;
};

type PreviewMode = "standard" | "compatible";
type RecordingStatus =
  | "UNDECIDED"
  | "READY_TO_RECORD"
  | "OPTED_OUT"
  | "RECORDING"
  | "SAVING"
  | "SAVED"
  | "FAILED"
  | "UNSUPPORTED"
  | "PERMISSION_DENIED";

type TrainingSessionClientProps = Readonly<{
  sessionId: string;
  projectId: string;
  projectName: string;
  initialStatus: string;
  initialPageIndex: number;
  initialPitchStartedAt: string | null;
  initialElapsedSec: number;
  initialRemainingSec: number;
  initialPitchDurationSec: number | null;
  files: TrainingFile[];
  previewFile: TrainingFile | null;
  initialRecording: TrainingRecording | null;
  initialAnalysis: TrainingAnalysis | null;
  autoStartRecordingOnMount?: boolean;
  redirectToQaAfterPitchEnd?: boolean;
  showAnalysisPanel?: boolean;
}>;

const pitchLimitSec = 9 * 60;
const pdfWorkerSrc = new URL(
  "pdfjs-dist/build/pdf.worker.mjs",
  import.meta.url,
).toString();
const pdfCMapUrl = "/pdfjs/cmaps/";
const pdfStandardFontDataUrl = "/pdfjs/standard_fonts/";
const pdfWasmUrl = "/pdfjs/wasm/";
const pdfIccUrl = "/pdfjs/iccs/";
const recordingMimeTypeCandidates = [
  "audio/webm;codecs=opus",
  "audio/webm",
  "audio/mp4",
  "audio/mpeg",
  "audio/wav",
];

function formatDuration(totalSec: number) {
  const minutes = Math.floor(totalSec / 60)
    .toString()
    .padStart(2, "0");
  const seconds = (totalSec % 60).toString().padStart(2, "0");

  return `${minutes}:${seconds}`;
}

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

function getSupportedRecordingMimeType() {
  if (typeof MediaRecorder === "undefined") {
    return "";
  }

  return (
    recordingMimeTypeCandidates.find((mimeType) =>
      MediaRecorder.isTypeSupported(mimeType),
    ) ?? ""
  );
}

function getRecordingFileExtension(mimeType: string) {
  const normalizedMimeType = mimeType.split(";")[0]?.toLowerCase() ?? "";

  if (normalizedMimeType === "audio/mp4") {
    return "m4a";
  }

  if (normalizedMimeType === "audio/mpeg") {
    return "mp3";
  }

  if (normalizedMimeType === "audio/wav") {
    return "wav";
  }

  return "webm";
}

function stringifyAnalysisValue(value: unknown) {
  if (value === null || value === undefined || value === "") {
    return "暂无";
  }

  if (typeof value === "string" || typeof value === "number") {
    return String(value);
  }

  return JSON.stringify(value);
}

function getCoverageLabel(value: TrainingCoverageItem["covered"]) {
  const labels: Record<TrainingCoverageItem["covered"], string> = {
    true: "已覆盖",
    false: "未覆盖",
    partial: "部分覆盖",
  };

  return labels[value] ?? value;
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
  const [pdfDocument, setPdfDocument] = useState<PDFDocumentProxy | null>(null);
  const [totalPages, setTotalPages] = useState<number | null>(null);
  const [pdfError, setPdfError] = useState("");
  const [isPdfLoading, setIsPdfLoading] = useState(Boolean(previewFile));
  const [renderTick, setRenderTick] = useState(0);
  const [previewMode, setPreviewMode] = useState<PreviewMode>("standard");
  const [recordingStatus, setRecordingStatus] =
    useState<RecordingStatus>(initialRecording ? "SAVED" : "UNDECIDED");
  const [recordingMessage, setRecordingMessage] = useState(
    initialRecording ? "录音已保存。" : "",
  );
  const [recordingId, setRecordingId] = useState(initialRecording?.id ?? "");
  const [recordingPlaybackUrl, setRecordingPlaybackUrl] = useState(
    initialRecording?.playbackUrl ?? "",
  );
  const [transcript, setTranscript] = useState<TrainingTranscript | null>(
    initialRecording?.transcript ?? null,
  );
  const [transcriptDraft, setTranscriptDraft] = useState(
    initialRecording?.transcript?.text ?? "",
  );
  const [isTranscriptEditing, setIsTranscriptEditing] = useState(
    !initialRecording?.transcript,
  );
  const [isTranscriptSaving, setIsTranscriptSaving] = useState(false);
  const [transcriptMessage, setTranscriptMessage] = useState("");
  const [analysis, setAnalysis] = useState<TrainingAnalysis | null>(
    initialAnalysis,
  );
  const [isAnalysisLoading, setIsAnalysisLoading] = useState(false);
  const [analysisMessage, setAnalysisMessage] = useState("");
  const [showRecordingPrepDialog, setShowRecordingPrepDialog] = useState(
    initialStatus === "CREATED",
  );
  const [showRecordingOptOutConfirm, setShowRecordingOptOutConfirm] =
    useState(false);
  const [showRecordingReenableConfirm, setShowRecordingReenableConfirm] =
    useState(false);
  const [isBigScreenMode, setIsBigScreenMode] = useState(
    initialStatus === "PITCHING",
  );
  const [isGuardResolved, setIsGuardResolved] = useState(false);
  const [prepCountdown, setPrepCountdown] = useState<number | null>(null);
  const prepCountdownIntervalRef = useRef<number | null>(null);
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const [isFullscreenSupported, setIsFullscreenSupported] = useState(false);
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const [isFullscreenActive, setIsFullscreenActive] = useState(false);
  const [fullscreenMessage, setFullscreenMessage] = useState("");
  const trainingShellRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const previewContainerRef = useRef<HTMLDivElement | null>(null);
  const renderTaskRef = useRef<RenderTask | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const recordingChunksRef = useRef<Blob[]>([]);
  const recordingStartedAtRef = useRef<Date | null>(null);
  const recordingMimeTypeRef = useRef("");
  const hasHandledPitchRecordingPreferenceRef = useRef(false);
  const hasAutoEndedPitchRef = useRef(false);
  const isCompletingNormallyRef = useRef(false);
  const isPitching = status === "PITCHING";
  const isEnded = status === "PITCH_ENDED" || status === "FINISHED";
  const primaryFileId = previewFile?.id ?? null;
  const currentPageNumber = pageIndex + 1;
  const previewUrl = previewFile
    ? `/api/files/${previewFile.id}/preview`
    : null;
  const compatiblePreviewUrl = previewUrl
    ? `${previewUrl}#page=${currentPageNumber}`
    : null;
  const canGoPrev = pageIndex > 0;
  const canGoNext =
    previewFile && totalPages !== null ? pageIndex < totalPages - 1 : true;
  const pageLabel = totalPages
    ? `${currentPageNumber} / ${totalPages}`
    : String(currentPageNumber);
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

  useEffect(() => {
    if (!previewFile || !previewUrl) {
      return;
    }

    const pdfUrl = previewUrl;
    let cancelled = false;
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
          useWasm: true,
          iccUrl: pdfIccUrl,
          useSystemFonts: false,
          disableFontFace: true,
          isEvalSupported: true,
          fontExtraProperties: true,
        });

        const loadedDocument = await loadingTask.promise;

        if (cancelled) {
          await loadedDocument.destroy();
          return;
        }

        setPdfDocument(loadedDocument);
        setTotalPages(loadedDocument.numPages);
        setPageIndex((currentIndex) =>
          Math.min(Math.max(currentIndex, 0), loadedDocument.numPages - 1),
        );
      } catch (error) {
        if (!cancelled) {
          const message =
            error instanceof Error ? error.message : "PDF 加载失败。";

          setPdfDocument(null);
          setTotalPages(null);
          setPdfError(`PDF 加载失败：${message}`);
        }
      } finally {
        if (!cancelled) {
          setIsPdfLoading(false);
        }
      }
    }

    void loadPdf();

    return () => {
      cancelled = true;
      renderTaskRef.current?.cancel();
      void loadingTask?.destroy();
    };
  }, [previewFile, previewUrl]);

  useEffect(() => {
    if (!pdfDocument || !canvasRef.current || previewMode !== "standard") {
      return;
    }

    let cancelled = false;
    const canvas = canvasRef.current;
    const loadedDocument = pdfDocument;

    async function renderPage() {
      renderTaskRef.current?.cancel();

      try {
        const page = await loadedDocument.getPage(currentPageNumber);

        if (cancelled) {
          return;
        }

        const baseViewport = page.getViewport({ scale: 1 });
        const containerWidth =
          previewContainerRef.current?.clientWidth ?? baseViewport.width;
        const containerHeight =
          previewContainerRef.current?.clientHeight ?? baseViewport.height;
        const widthScale = containerWidth / baseViewport.width;
        const heightScale =
          containerHeight > 0
            ? containerHeight / baseViewport.height
            : widthScale;
        const cssScale = Math.max(
          0.1,
          Math.min(widthScale, heightScale, isBigScreenMode ? 4 : 2.5),
        );
        const viewport = page.getViewport({ scale: cssScale });
        const outputScale = window.devicePixelRatio || 1;
        const context = canvas.getContext("2d");

        if (!context) {
          throw new Error("当前浏览器不支持 Canvas 渲染。");
        }

        canvas.width = Math.floor(viewport.width * outputScale);
        canvas.height = Math.floor(viewport.height * outputScale);
        canvas.style.width = `${Math.floor(viewport.width)}px`;
        canvas.style.height = `${Math.floor(viewport.height)}px`;

        const renderTask = page.render({
          canvas,
          canvasContext: context,
          transform:
            outputScale !== 1
              ? ([outputScale, 0, 0, outputScale, 0, 0] as [
                  number,
                  number,
                  number,
                  number,
                  number,
                  number,
                ])
              : undefined,
          viewport,
        });

        renderTaskRef.current = renderTask;
        await renderTask.promise;
      } catch (error) {
        if (
          !cancelled &&
          error instanceof Error &&
          error.name !== "RenderingCancelledException"
        ) {
          setPdfError(`PDF 页面渲染失败：${error.message}`);
        }
      }
    }

    void renderPage();

    return () => {
      cancelled = true;
      renderTaskRef.current?.cancel();
    };
  }, [
    currentPageNumber,
    isBigScreenMode,
    pdfDocument,
    previewMode,
    renderTick,
  ]);

  useEffect(() => {
    if (!previewFile) {
      return;
    }

    const handleResize = () => {
      setRenderTick((tick) => tick + 1);
    };

    window.addEventListener("resize", handleResize);

    return () => window.removeEventListener("resize", handleResize);
  }, [previewFile]);

  useEffect(() => {
    const previewContainer = previewContainerRef.current;

    if (!previewContainer || !previewFile) {
      return;
    }

    const observer = new ResizeObserver(() => {
      setRenderTick((tick) => tick + 1);
    });

    observer.observe(previewContainer);

    return () => observer.disconnect();
  }, [previewFile, previewMode]);

  useEffect(() => {
    setIsFullscreenSupported(
      Boolean(document.fullscreenEnabled && trainingShellRef.current),
    );

    const handleFullscreenChange = () => {
      setIsFullscreenActive(document.fullscreenElement !== null);
      setRenderTick((tick) => tick + 1);
    };

    document.addEventListener("fullscreenchange", handleFullscreenChange);

    return () => {
      document.removeEventListener("fullscreenchange", handleFullscreenChange);
    };
  }, []);

  const enterBigScreen = useCallback(async (requestBrowserFullscreen = true) => {
    setFullscreenMessage("");
    setIsBigScreenMode(true);
    setRenderTick((tick) => tick + 1);

    if (!requestBrowserFullscreen) {
      return true;
    }

    if (!document.fullscreenEnabled || !trainingShellRef.current) {
      setFullscreenMessage("当前浏览器不支持全屏，可继续使用大屏模式。");
      return false;
    }

    try {
      await trainingShellRef.current.requestFullscreen();
      return true;
    } catch {
      setFullscreenMessage("浏览器阻止了自动全屏，请点击“进入全屏”。");
      return false;
    }
  }, []);

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const exitBigScreen = useCallback(async () => {
    setIsBigScreenMode(false);
    setFullscreenMessage("");
    setRenderTick((tick) => tick + 1);

    if (document.fullscreenElement) {
      await document.exitFullscreen().catch(() => {
        setFullscreenMessage("退出浏览器全屏失败，可按 Esc 退出。");
      });
    }
  }, []);

  const stopMediaStream = useCallback(() => {
    mediaStreamRef.current?.getTracks().forEach((track) => track.stop());
    mediaStreamRef.current = null;
  }, []);

  const prepareRecording = useCallback(async () => {
    setRecordingPlaybackUrl("");

    if (
      typeof navigator === "undefined" ||
      !navigator.mediaDevices?.getUserMedia ||
      typeof MediaRecorder === "undefined"
    ) {
      setRecordingStatus("UNSUPPORTED");
      setRecordingMessage("当前浏览器不支持录音，本次仅记录路演操作。");
      setShowRecordingReenableConfirm(false);
      return;
    }

    if (
      mediaStreamRef.current
        ?.getAudioTracks()
        .some((track) => track.readyState === "live")
    ) {
      setRecordingStatus("READY_TO_RECORD");
      setRecordingMessage("麦克风已就绪，本轮将录音。");
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });

      stopMediaStream();
      mediaStreamRef.current = stream;
      recordingMimeTypeRef.current =
        getSupportedRecordingMimeType() || "audio/webm";
      setRecordingStatus("READY_TO_RECORD");
      setRecordingMessage("麦克风已就绪，本轮将录音。");
      setShowRecordingPrepDialog(false);
      setShowRecordingOptOutConfirm(false);
      setShowRecordingReenableConfirm(false);
    } catch {
      stopMediaStream();
      setRecordingStatus("PERMISSION_DENIED");
      setRecordingMessage(
        "麦克风权限未开启，本次可继续训练，但不会保存录音。",
      );
      setShowRecordingOptOutConfirm(false);
      setShowRecordingReenableConfirm(false);
    }
  }, [stopMediaStream]);

  const confirmRecordingOptOut = useCallback(() => {
    stopMediaStream();
    mediaRecorderRef.current = null;
    recordingChunksRef.current = [];
    recordingStartedAtRef.current = null;
    recordingMimeTypeRef.current = "";
    setRecordingStatus("OPTED_OUT");
    setRecordingPlaybackUrl("");
    setRecordingMessage("本轮未启用录音，仅记录翻页和用时。");
    setShowRecordingOptOutConfirm(false);
    setShowRecordingPrepDialog(false);
    setShowRecordingReenableConfirm(false);
  }, [stopMediaStream]);

  const uploadRecording = useCallback(
    async (blob: Blob, startedAt: Date | null, endedAt: Date) => {
      if (blob.size <= 0) {
        setRecordingStatus("FAILED");
        setRecordingMessage("录音文件为空，未保存。");
        return;
      }

      const formData = new FormData();
      const mimeType =
        blob.type || recordingMimeTypeRef.current || "audio/webm";
      const extension = getRecordingFileExtension(mimeType);
      const durationSec = startedAt
        ? Math.max(0, Math.round((endedAt.getTime() - startedAt.getTime()) / 1000))
        : null;

      formData.append("file", blob, `pitch-recording.${extension}`);
      formData.append("phase", "PITCH");
      formData.append("endedAt", endedAt.toISOString());

      if (startedAt) {
        formData.append("startedAt", startedAt.toISOString());
      }

      if (durationSec !== null) {
        formData.append("durationSec", String(durationSec));
      }

      setRecordingStatus("SAVING");
      setRecordingMessage("录音上传保存中...");

      try {
        const response = await fetch(`/training/${sessionId}/recordings`, {
          method: "POST",
          body: formData,
        });

        if (!response.ok) {
          const body = (await response.json().catch(() => null)) as {
            error?: string;
          } | null;

          throw new Error(body?.error ?? "录音上传失败。");
        }

        const body = (await response.json()) as {
          recording: {
            id: string;
            playbackUrl: string;
            mimeType: string;
          };
        };

        setRecordingStatus("SAVED");
        setRecordingMessage("录音已保存。");
        setRecordingId(body.recording.id);
        setRecordingPlaybackUrl(body.recording.playbackUrl);
        setTranscript(null);
        setTranscriptDraft("");
        setIsTranscriptEditing(true);
        setTranscriptMessage("");
      } catch (error) {
        setRecordingStatus("FAILED");
        setRecordingMessage(
          error instanceof Error ? error.message : "录音上传失败。",
        );
      }
    },
    [sessionId],
  );

  const startRecording = useCallback(async () => {
    setRecordingPlaybackUrl("");

    if (typeof MediaRecorder === "undefined") {
      setRecordingStatus("UNSUPPORTED");
      setRecordingMessage("当前浏览器不支持录音，本次仅记录路演操作。");
      return;
    }

    const stream = mediaStreamRef.current;
    const hasLiveAudioTrack = stream
      ?.getAudioTracks()
      .some((track) => track.readyState === "live");

    if (!stream || !hasLiveAudioTrack) {
      if (recordingStatus === "PERMISSION_DENIED") {
        setRecordingMessage(
          "麦克风权限未开启，本次可继续训练，但不会保存录音。",
        );
        return;
      }

      if (recordingStatus === "UNSUPPORTED") {
        setRecordingMessage("当前浏览器不支持录音，本次仅记录路演操作。");
        return;
      }

      if (recordingStatus === "OPTED_OUT") {
        setRecordingMessage("未启用录音，仅记录路演操作。");
        return;
      }

      setRecordingStatus("UNDECIDED");
      setRecordingMessage("未启用录音，仅记录路演操作。");
      return;
    }

    const mimeType =
      recordingMimeTypeRef.current || getSupportedRecordingMimeType();

    try {
      const recorder = mimeType
        ? new MediaRecorder(stream, { mimeType })
        : new MediaRecorder(stream);

      mediaRecorderRef.current = recorder;
      recordingChunksRef.current = [];
      recordingStartedAtRef.current = new Date();
      recordingMimeTypeRef.current =
        recorder.mimeType || mimeType || "audio/webm";

      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          recordingChunksRef.current.push(event.data);
        }
      };
      recorder.onerror = () => {
        setRecordingStatus("FAILED");
        setRecordingMessage("录音过程中出现错误，本次可能无法保存音频。");
      };
      recorder.start(1000);

      setRecordingStatus("RECORDING");
      setRecordingMessage("");
    } catch {
      stopMediaStream();
      mediaRecorderRef.current = null;
      recordingStartedAtRef.current = null;
      recordingChunksRef.current = [];
      setRecordingStatus("FAILED");
      setRecordingMessage("录音启动失败，本次仅记录路演操作。");
    }
  }, [recordingStatus, stopMediaStream]);

  useEffect(() => {
    if (
      !autoStartRecordingOnMount ||
      !isPitching ||
      !isGuardResolved ||
      hasHandledPitchRecordingPreferenceRef.current ||
      initialRecording
    ) {
      return;
    }

    hasHandledPitchRecordingPreferenceRef.current = true;
    const preference =
      window.sessionStorage.getItem(`training:${sessionId}:recordingPreference`) ??
      "skip";

    if (preference !== "record") {
      window.setTimeout(() => {
        setRecordingStatus("OPTED_OUT");
        setRecordingMessage("本轮未启用录音，仅记录翻页和用时。");
      }, 0);
      return;
    }

    async function prepareAndStartRecording() {
      if (
        typeof navigator === "undefined" ||
        !navigator.mediaDevices?.getUserMedia ||
        typeof MediaRecorder === "undefined"
      ) {
        setRecordingStatus("UNSUPPORTED");
        setRecordingMessage(
          "当前浏览器不支持录音，本次仅记录翻页和用时。",
        );
        return;
      }

      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });

        stopMediaStream();
        mediaStreamRef.current = stream;
        recordingMimeTypeRef.current =
          getSupportedRecordingMimeType() || "audio/webm";
        setRecordingStatus("READY_TO_RECORD");
        setRecordingMessage("");
        await startRecording();
      } catch {
        stopMediaStream();
        setRecordingStatus("PERMISSION_DENIED");
        setRecordingMessage(
          "麦克风权限未开启，本轮将继续记录翻页和用时，但不会保存录音。",
        );
      }
    }

    void prepareAndStartRecording();
  }, [
    autoStartRecordingOnMount,
    initialRecording,
    isGuardResolved,
    isPitching,
    sessionId,
    startRecording,
    stopMediaStream,
  ]);

  const stopRecordingAndUpload = useCallback(async () => {
    const recorder = mediaRecorderRef.current;

    if (!recorder || recorder.state === "inactive") {
      stopMediaStream();
      return;
    }

    await new Promise<void>((resolve) => {
      recorder.onstop = () => {
        const endedAt = new Date();
        const blob = new Blob(recordingChunksRef.current, {
          type: recordingMimeTypeRef.current || recorder.mimeType || "audio/webm",
        });

        mediaRecorderRef.current = null;
        stopMediaStream();
        void uploadRecording(blob, recordingStartedAtRef.current, endedAt).finally(
          () => {
            recordingChunksRef.current = [];
            recordingStartedAtRef.current = null;
            recordingMimeTypeRef.current = "";
            resolve();
          },
        );
      };

      try {
        recorder.requestData();
        recorder.stop();
      } catch {
        mediaRecorderRef.current = null;
        stopMediaStream();
        setRecordingStatus("FAILED");
        setRecordingMessage("停止录音失败，未保存音频。");
        resolve();
      }
    });
  }, [stopMediaStream, uploadRecording]);

  useEffect(() => {
    return () => {
      if (mediaRecorderRef.current?.state === "recording") {
        mediaRecorderRef.current.stop();
      }

      stopMediaStream();

      if (prepCountdownIntervalRef.current !== null) {
        window.clearInterval(prepCountdownIntervalRef.current);
        prepCountdownIntervalRef.current = null;
      }
    };
  }, [stopMediaStream]);

  const saveTranscript = useCallback(async () => {
    const text = transcriptDraft.trim();

    if (!recordingId) {
      setTranscriptMessage("录音尚未保存，不能保存转写文本。");
      return;
    }

    if (!text) {
      setTranscriptMessage("转写文本不能为空。");
      return;
    }

    setIsTranscriptSaving(true);
    setTranscriptMessage("");

    try {
      const response = await fetch(
        `/training/${sessionId}/recordings/${recordingId}/transcript`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            text,
            source: "MANUAL",
            language: "zh-CN",
          }),
        },
      );

      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as {
          error?: string;
        } | null;

        throw new Error(body?.error ?? "转写文本保存失败。");
      }

      const body = (await response.json()) as {
        transcript: TrainingTranscript;
      };

      setTranscript(body.transcript);
      setTranscriptDraft(body.transcript.text);
      setIsTranscriptEditing(false);
      setTranscriptMessage("转写文本已保存。");
    } catch (error) {
      setTranscriptMessage(
        error instanceof Error ? error.message : "转写文本保存失败。",
      );
    } finally {
      setIsTranscriptSaving(false);
    }
  }, [recordingId, sessionId, transcriptDraft]);

  const generateAnalysis = useCallback(async () => {
    if (!isEnded) {
      setAnalysisMessage("请先结束路演后再分析。");
      return;
    }

    if (!transcript?.text.trim()) {
      setAnalysisMessage("请先保存转写文本后再分析。");
      return;
    }

    setIsAnalysisLoading(true);
    setAnalysisMessage("");

    try {
      const response = await fetch(`/training/${sessionId}/analysis`, {
        method: "POST",
      });
      const body = (await response.json().catch(() => null)) as {
        analysis?: TrainingAnalysis;
        error?: string;
      } | null;

      if (!response.ok) {
        throw new Error(body?.error ?? "路演表现分析生成失败。");
      }

      if (!body?.analysis) {
        throw new Error("路演表现分析接口未返回分析结果。");
      }

      setAnalysis(body.analysis);
      setAnalysisMessage("路演表现分析已生成。");
    } catch (error) {
      setAnalysisMessage(
        error instanceof Error ? error.message : "路演表现分析生成失败。",
      );
    } finally {
      setIsAnalysisLoading(false);
    }
  }, [isEnded, sessionId, transcript]);

  const recordSlideEvent = useCallback(
    async (eventType: "NEXT" | "PREV" | "JUMP", nextPageIndex: number) => {
      const response = await fetch(`/training/${sessionId}/events`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          eventType,
          pageIndex: nextPageIndex + 1,
          elapsedSec,
          fileId: primaryFileId,
        }),
      });

      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as {
          error?: string;
        } | null;

        throw new Error(body?.error ?? "翻页事件记录失败。");
      }
    },
    [elapsedSec, primaryFileId, sessionId],
  );

  const changePage = useCallback(
    async (direction: "NEXT" | "PREV") => {
      if (isSubmitting) {
        return;
      }

      const nextPageIndex =
        direction === "NEXT"
          ? Math.min(
              pageIndex + 1,
              totalPages === null ? pageIndex + 1 : totalPages - 1,
            )
          : Math.max(0, pageIndex - 1);

      if (nextPageIndex === pageIndex) {
        return;
      }

      setIsSubmitting(true);
      setMessage("");

      try {
        if (isPitching) {
          await recordSlideEvent(direction, nextPageIndex);
        }

        setPageIndex(nextPageIndex);
      } catch (error) {
        setMessage(error instanceof Error ? error.message : "翻页失败。");
      } finally {
        setIsSubmitting(false);
      }
    },
    [isPitching, isSubmitting, pageIndex, recordSlideEvent, totalPages],
  );

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
    if (
      status === "CREATED" &&
      recordingStatus === "UNDECIDED"
    ) {
      setShowRecordingPrepDialog(true);
      setShowRecordingOptOutConfirm(false);
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
    if (
      status === "CREATED" &&
      recordingStatus === "UNDECIDED"
    ) {
      setShowRecordingPrepDialog(true);
      setShowRecordingOptOutConfirm(false);
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
      if (recordingStatus === "READY_TO_RECORD") {
        void startRecording();
      } else if (recordingStatus === "OPTED_OUT") {
        setRecordingMessage("未启用录音，仅记录路演操作。");
      } else if (recordingStatus === "PERMISSION_DENIED") {
        setRecordingMessage(
          "麦克风权限未开启，本次可继续训练，但不会保存录音。",
        );
      } else if (recordingStatus === "UNSUPPORTED") {
        setRecordingMessage("当前浏览器不支持录音，本次仅记录路演操作。");
      }

    } catch (error) {
      setMessage(error instanceof Error ? error.message : "开始路演失败。");
    } finally {
      setIsSubmitting(false);
    }
  }

  const endPitch = useCallback(async () => {
    setIsSubmitting(true);
    setMessage("");
    const shouldUploadRecording =
      mediaRecorderRef.current?.state === "recording";

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

      if (shouldUploadRecording) {
        await stopRecordingAndUpload();
      }

      if (!shouldUploadRecording) {
        stopMediaStream();
        setRecordingStatus((currentStatus) =>
          currentStatus === "OPTED_OUT" ||
          currentStatus === "PERMISSION_DENIED" ||
          currentStatus === "UNSUPPORTED"
            ? currentStatus
            : "UNDECIDED",
        );
        setRecordingMessage("本次未启用录音。");
      }

      if (redirectToQaAfterPitchEnd) {
        isCompletingNormallyRef.current = true;
        router.replace(`/training/${sessionId}/qa`);
      }
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "结束路演失败。");
    } finally {
      setIsSubmitting(false);
    }
  }, [
    currentPageNumber,
    elapsedSec,
    primaryFileId,
    redirectToQaAfterPitchEnd,
    router,
    sessionId,
    stopMediaStream,
    stopRecordingAndUpload,
  ]);

  useEffect(() => {
    if (!isPitching || remainingSec > 0 || hasAutoEndedPitchRef.current) {
      return;
    }

    hasAutoEndedPitchRef.current = true;
    void endPitch();
  }, [endPitch, isPitching, remainingSec]);

  const shellClassName = isBigScreenMode
    ? "fixed inset-0 z-50 grid h-screen w-screen gap-3 overflow-hidden bg-slate-950 p-3 text-white lg:grid-cols-[minmax(0,1fr)_280px]"
    : "grid gap-5 lg:grid-cols-[minmax(0,1fr)_320px]";
  const mainPanelClassName = isBigScreenMode
    ? "flex min-h-0 flex-col rounded-lg border border-slate-700 bg-slate-900/95 p-3 shadow-2xl"
    : "rounded-lg border border-slate-200 bg-white p-6 shadow-sm";
  const headerClassName = isBigScreenMode
    ? "flex flex-col gap-3 border-b border-slate-700 pb-3 sm:flex-row sm:items-start sm:justify-between"
    : "flex flex-col gap-4 border-b border-slate-200 pb-5 sm:flex-row sm:items-start sm:justify-between";
  const timerClassName =
    remainingSec <= 60
      ? isBigScreenMode
        ? "mt-1 text-5xl font-semibold text-red-300"
        : "mt-2 text-4xl font-semibold text-red-700"
      : isBigScreenMode
        ? "mt-1 text-5xl font-semibold text-white"
        : "mt-2 text-4xl font-semibold text-slate-950";
  const previewPanelClassName = isBigScreenMode
    ? "mt-3 grid min-h-0 flex-1 place-items-center rounded-lg border border-slate-700 bg-slate-950 p-2 text-center"
    : "mt-5 grid min-h-[calc(100vh-310px)] place-items-center rounded-lg border border-slate-200 bg-slate-100 p-4 text-center";
  const previewScrollerClassName = isBigScreenMode
    ? previewMode === "standard"
      ? "grid h-full min-h-0 place-items-center overflow-hidden rounded-md border border-slate-700 bg-slate-950 p-2"
      : "grid h-full min-h-0 overflow-hidden rounded-md border border-slate-700 bg-slate-950"
    : previewMode === "standard"
      ? "grid h-[calc(100vh-390px)] min-h-96 place-items-center overflow-hidden rounded-md border border-slate-200 bg-slate-200 p-4"
      : "grid h-[calc(100vh-390px)] min-h-96 overflow-hidden rounded-md border border-slate-200 bg-slate-200";
  const secondaryPanelClassName = isBigScreenMode
    ? "rounded-lg border border-slate-700 bg-slate-900/90 p-4 shadow-sm"
    : "rounded-lg border border-slate-200 bg-white p-5 shadow-sm";
  const secondaryTitleClassName = isBigScreenMode
    ? "text-sm font-semibold text-white"
    : "text-base font-semibold text-slate-950";
  const mutedTextClassName = isBigScreenMode
    ? "text-slate-300"
    : "text-slate-500";
  const valueTextClassName = isBigScreenMode
    ? "font-medium text-white"
    : "font-medium text-slate-950";
  const canShowTranscriptEditor =
    isEnded && recordingStatus === "SAVED" && Boolean(recordingId);
  const transcriptBoxClassName = isBigScreenMode
    ? "mt-4 rounded-md border border-slate-700 bg-slate-950/60 p-3"
    : "mt-4 rounded-md border border-slate-200 bg-slate-50 p-3";
  const transcriptTextClassName = isBigScreenMode
    ? "whitespace-pre-wrap text-sm leading-6 text-slate-100"
    : "whitespace-pre-wrap text-sm leading-6 text-slate-700";

  return (
    <>
      {!isGuardResolved ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70">
          <p className="text-xl font-semibold text-white">正在结束训练...</p>
        </div>
      ) : null}
      {isGuardResolved && prepCountdown !== null ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70">
          <p className="text-6xl font-bold text-white">
            {prepCountdown >= 4
              ? "请准备"
              : prepCountdown >= 1
                ? String(prepCountdown)
                : "开始路演"}
          </p>
        </div>
      ) : null}
      <div ref={trainingShellRef} className={shellClassName}>
      <section className={mainPanelClassName}>
        <div className={headerClassName}>
          <div>
            {isBigScreenMode ? (
              <p className="text-xs font-medium text-slate-400">
                {projectName}
              </p>
            ) : null}
            <p className={`text-xs font-medium ${mutedTextClassName}`}>
              训练状态
            </p>
            <h2
              className={
                isBigScreenMode
                  ? "mt-1 text-2xl font-semibold text-white"
                  : "mt-2 text-xl font-semibold text-slate-950"
              }
            >
              {statusLabel}
            </h2>
            <p
              className={
                isBigScreenMode
                  ? "mt-1 text-sm text-slate-300"
                  : "mt-2 text-sm text-slate-600"
              }
            >
              {statusHint}
            </p>
            <div
              className={
                isBigScreenMode
                  ? "mt-2 inline-flex rounded-md border border-slate-700 bg-slate-950 px-2.5 py-1 text-xs font-medium text-slate-200"
                  : "mt-3 inline-flex rounded-md border border-slate-200 bg-slate-50 px-2.5 py-1 text-xs font-medium text-slate-700"
              }
            >
              {recordingStatusLabel}
            </div>
          </div>
          <div className="text-left sm:text-right">
            <p className={`text-xs font-medium ${mutedTextClassName}`}>
              9 分钟倒计时
            </p>
            <p className={timerClassName}>
              {formatDuration(remainingSec)}
            </p>
            {isBigScreenMode ? (
              <p className="mt-1 text-sm text-slate-300">{pageLabel}</p>
            ) : null}
          </div>
        </div>

        {message ? (
          <p className="mt-5 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
            {message}
          </p>
        ) : null}

        {fullscreenMessage ? (
          <p
            className={
              isBigScreenMode
                ? "mt-3 rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm text-amber-100"
                : "mt-5 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800"
            }
          >
            {fullscreenMessage}
          </p>
        ) : null}

        <div className={previewPanelClassName}>
          {previewFile ? (
            <div className="grid h-full min-h-0 w-full grid-rows-[auto_minmax(0,1fr)] gap-3">
              <div className="flex flex-col gap-2 text-left sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <p
                    className={
                      isBigScreenMode
                        ? "text-sm font-medium text-white"
                        : "text-sm font-medium text-slate-950"
                    }
                  >
                    {previewFile.originalName}
                  </p>
                  <p
                    className={
                      isBigScreenMode
                        ? "mt-1 text-xs text-slate-300"
                        : "mt-1 text-xs text-slate-500"
                    }
                  >
                    PDF 单页预览，当前 {pageLabel}
                  </p>
                  <p
                    className={
                      isBigScreenMode
                        ? "mt-1 text-xs text-slate-400"
                        : "mt-1 text-xs text-slate-500"
                    }
                  >
                    如预览仍异常，可使用原始 PDF 打开检查。
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <div
                    className={
                      isBigScreenMode
                        ? "inline-flex rounded-md border border-slate-700 bg-slate-900 p-1"
                        : "inline-flex rounded-md border border-slate-200 bg-white p-1"
                    }
                  >
                    <button
                      type="button"
                      onClick={() => setPreviewMode("standard")}
                      className={
                        previewMode === "standard"
                          ? "rounded px-2.5 py-1 text-xs font-medium text-white bg-slate-950"
                          : isBigScreenMode
                            ? "rounded px-2.5 py-1 text-xs font-medium text-slate-300 hover:bg-slate-800"
                            : "rounded px-2.5 py-1 text-xs font-medium text-slate-600 hover:bg-slate-100"
                      }
                    >
                      标准预览
                    </button>
                    <button
                      type="button"
                      onClick={() => setPreviewMode("compatible")}
                      className={
                        previewMode === "compatible"
                          ? "rounded px-2.5 py-1 text-xs font-medium text-white bg-slate-950"
                          : isBigScreenMode
                            ? "rounded px-2.5 py-1 text-xs font-medium text-slate-300 hover:bg-slate-800"
                            : "rounded px-2.5 py-1 text-xs font-medium text-slate-600 hover:bg-slate-100"
                      }
                    >
                      兼容预览
                    </button>
                  </div>
                  <span className="inline-flex w-fit rounded-md border border-teal-200 bg-teal-50 px-2.5 py-1 text-xs font-medium text-teal-800">
                    PDF
                  </span>
                </div>
              </div>
              <div
                ref={previewContainerRef}
                className={previewScrollerClassName}
              >
                {previewMode === "compatible" && compatiblePreviewUrl ? (
                  <div className="grid h-full min-h-0 w-full grid-rows-[minmax(0,1fr)_auto]">
                    <iframe
                      title={`${previewFile.originalName} 兼容预览`}
                      src={compatiblePreviewUrl}
                      className="h-full min-h-0 w-full border-0 bg-white"
                    />
                    <p
                      className={
                        isBigScreenMode
                          ? "px-3 py-2 text-left text-xs text-slate-300"
                          : "bg-white px-3 py-2 text-left text-xs text-slate-600"
                      }
                    >
                      兼容模式主要用于查看显示效果；系统页码和训练事件仍以外层按钮、键盘和翻页笔为准。
                    </p>
                  </div>
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
                    className="max-w-full rounded-sm bg-white shadow"
                  />
                )}
              </div>
            </div>
          ) : (
            <div>
              <p className="text-sm font-medium text-slate-500">
                当前暂无可预览 PDF，已显示页码占位
              </p>
              <p className="mt-4 text-6xl font-semibold text-slate-950">
                {currentPageNumber}
              </p>
              <p className="mt-3 text-sm text-slate-600">当前页码</p>
            </div>
          )}
        </div>

        <div
          className={
            isBigScreenMode
              ? "mt-3 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between"
              : "mt-5 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between"
          }
        >
          <div className="flex flex-wrap gap-2">
            {status === "CREATED" && recordingStatus === "OPTED_OUT" ? (
              <button
                type="button"
                onClick={() => setShowRecordingReenableConfirm(true)}
                disabled={isSubmitting}
                className="inline-flex h-10 items-center justify-center rounded-md border border-slate-300 bg-white px-4 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-50 disabled:cursor-not-allowed disabled:bg-slate-100 disabled:text-slate-400"
              >
                重新启用录音
              </button>
            ) : status === "CREATED" ? (
              <button
                type="button"
                onClick={() => void prepareRecording()}
                disabled={isSubmitting || recordingStatus === "READY_TO_RECORD"}
                className="inline-flex h-10 items-center justify-center rounded-md border border-slate-300 bg-white px-4 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-50 disabled:cursor-not-allowed disabled:bg-slate-100 disabled:text-slate-400"
              >
                {recordingStatus === "READY_TO_RECORD"
                  ? "麦克风已就绪"
                  : "准备录音"}
              </button>
            ) : null}
            <button
              type="button"
              onClick={endPitch}
              disabled={!isPitching || isSubmitting}
              className="inline-flex h-10 items-center justify-center rounded-md border border-red-200 bg-red-50 px-4 text-sm font-medium text-red-700 transition-colors hover:bg-red-100 disabled:cursor-not-allowed disabled:border-slate-200 disabled:bg-slate-100 disabled:text-slate-400"
            >
              结束路演
            </button>
          </div>

          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => void changePage("PREV")}
              disabled={!canGoPrev || isSubmitting}
              className="inline-flex h-10 items-center justify-center rounded-md border border-slate-300 bg-white px-4 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-50 disabled:cursor-not-allowed disabled:bg-slate-100 disabled:text-slate-400"
            >
              上一页
            </button>
            <button
              type="button"
              onClick={() => void changePage("NEXT")}
              disabled={!canGoNext || isSubmitting}
              className="inline-flex h-10 items-center justify-center rounded-md border border-slate-300 bg-white px-4 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-50 disabled:cursor-not-allowed disabled:bg-slate-100 disabled:text-slate-400"
            >
              下一页
            </button>
          </div>
        </div>
      </section>

      <aside
        className={
          isBigScreenMode
            ? "grid min-h-0 gap-3 overflow-hidden lg:grid-rows-[auto_minmax(0,1fr)]"
            : "grid gap-4"
        }
      >
        <section className={secondaryPanelClassName}>
          <h2 className={secondaryTitleClassName}>路演信息</h2>
          <dl className="mt-4 grid gap-3 text-sm">
            <div
              className={
                isBigScreenMode
                  ? "flex items-center justify-between border-b border-slate-700 pb-3"
                  : "flex items-center justify-between border-b border-slate-100 pb-3"
              }
            >
              <dt className={mutedTextClassName}>路演用时</dt>
              <dd className={valueTextClassName}>
                {formatDuration(elapsedSec)}
              </dd>
            </div>
            <div className="flex items-center justify-between">
              <dt className={mutedTextClassName}>当前页码</dt>
              <dd className={valueTextClassName}>
                {pageLabel}
              </dd>
            </div>
            <div
              className={
                isBigScreenMode
                  ? "flex items-center justify-between border-t border-slate-700 pt-3"
                  : "flex items-center justify-between border-t border-slate-100 pt-3"
              }
            >
              <dt className={mutedTextClassName}>录音状态</dt>
              <dd className={valueTextClassName}>{recordingStatusLabel}</dd>
            </div>
          </dl>
          {recordingMessage ? (
            <p
              className={
                isBigScreenMode
                  ? "mt-3 rounded-md border border-slate-700 bg-slate-950/60 p-3 text-xs leading-5 text-slate-300"
                  : "mt-3 rounded-md border border-slate-200 bg-slate-50 p-3 text-xs leading-5 text-slate-600"
              }
            >
              {recordingMessage}
            </p>
          ) : null}
          {recordingPlaybackUrl ? (
            <audio
              controls
              src={recordingPlaybackUrl}
              className="mt-3 w-full"
            >
              <track kind="captions" />
            </audio>
          ) : null}
          {canShowTranscriptEditor ? (
            <div className={transcriptBoxClassName}>
              <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                <h3
                  className={
                    isBigScreenMode
                      ? "text-sm font-semibold text-white"
                      : "text-sm font-semibold text-slate-950"
                  }
                >
                  转写文本
                </h3>
                {transcript && !isTranscriptEditing ? (
                  <button
                    type="button"
                    onClick={() => {
                      setTranscriptDraft(transcript.text);
                      setIsTranscriptEditing(true);
                      setTranscriptMessage("");
                    }}
                    className={
                      isBigScreenMode
                        ? "inline-flex h-8 items-center justify-center rounded-md border border-slate-600 px-3 text-xs font-medium text-slate-100 transition-colors hover:bg-slate-800"
                        : "inline-flex h-8 items-center justify-center rounded-md border border-slate-300 bg-white px-3 text-xs font-medium text-slate-700 transition-colors hover:bg-slate-50"
                    }
                  >
                    编辑转写文本
                  </button>
                ) : null}
              </div>
              {isTranscriptEditing ? (
                <div className="mt-3 grid gap-3">
                  {!transcript ? (
                    <p
                      className={
                        isBigScreenMode
                          ? "text-xs leading-5 text-slate-300"
                          : "text-xs leading-5 text-slate-600"
                      }
                    >
                      当前暂未接入自动转写，可先粘贴人工整理文本。
                    </p>
                  ) : null}
                  <textarea
                    value={transcriptDraft}
                    onChange={(event) => setTranscriptDraft(event.target.value)}
                    rows={isBigScreenMode ? 5 : 7}
                    className={
                      isBigScreenMode
                        ? "w-full resize-y rounded-md border border-slate-600 bg-slate-950 p-3 text-sm leading-6 text-white outline-none transition-colors placeholder:text-slate-500 focus:border-slate-300"
                        : "w-full resize-y rounded-md border border-slate-300 bg-white p-3 text-sm leading-6 text-slate-900 outline-none transition-colors placeholder:text-slate-400 focus:border-slate-500"
                    }
                    placeholder="粘贴或编辑人工整理后的路演转写文本"
                  />
                  <div className="flex flex-col gap-2 sm:flex-row sm:justify-end">
                    {transcript ? (
                      <button
                        type="button"
                        onClick={() => {
                          setTranscriptDraft(transcript.text);
                          setIsTranscriptEditing(false);
                          setTranscriptMessage("");
                        }}
                        disabled={isTranscriptSaving}
                        className={
                          isBigScreenMode
                            ? "inline-flex h-9 items-center justify-center rounded-md border border-slate-600 px-3 text-xs font-medium text-slate-100 transition-colors hover:bg-slate-800 disabled:cursor-not-allowed disabled:text-slate-500"
                            : "inline-flex h-9 items-center justify-center rounded-md border border-slate-300 bg-white px-3 text-xs font-medium text-slate-700 transition-colors hover:bg-slate-50 disabled:cursor-not-allowed disabled:text-slate-400"
                        }
                      >
                        取消编辑
                      </button>
                    ) : null}
                    <button
                      type="button"
                      onClick={() => void saveTranscript()}
                      disabled={isTranscriptSaving}
                      className="inline-flex h-9 items-center justify-center rounded-md bg-slate-950 px-3 text-xs font-medium text-white transition-colors hover:bg-slate-800 disabled:cursor-not-allowed disabled:bg-slate-300"
                    >
                      {isTranscriptSaving ? "保存中..." : "保存转写文本"}
                    </button>
                  </div>
                </div>
              ) : transcript ? (
                <p className={`${transcriptTextClassName} mt-3`}>
                  {transcript.text}
                </p>
              ) : null}
              {transcriptMessage ? (
                <p
                  className={
                    isBigScreenMode
                      ? "mt-3 text-xs leading-5 text-slate-300"
                      : "mt-3 text-xs leading-5 text-slate-600"
                  }
                >
                  {transcriptMessage}
                </p>
              ) : null}
            </div>
          ) : isEnded &&
            (recordingStatus === "OPTED_OUT" ||
              recordingStatus === "PERMISSION_DENIED" ||
              recordingStatus === "UNSUPPORTED") ? (
            <p
              className={
                isBigScreenMode
                  ? "mt-3 rounded-md border border-slate-700 bg-slate-950/60 p-3 text-xs leading-5 text-slate-300"
                  : "mt-3 rounded-md border border-slate-200 bg-slate-50 p-3 text-xs leading-5 text-slate-600"
              }
            >
              本次未启用录音，暂无转写文本。
            </p>
          ) : null}
        </section>

        {showAnalysisPanel ? (
        <section className={secondaryPanelClassName}>
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <h2 className={secondaryTitleClassName}>路演表现分析</h2>
              <p
                className={
                  isBigScreenMode
                    ? "mt-1 text-xs leading-5 text-slate-300"
                    : "mt-1 text-xs leading-5 text-slate-600"
                }
              >
                基于本轮转写文本、翻页事件和项目上下文生成。
              </p>
            </div>
            <button
              type="button"
              onClick={() => void generateAnalysis()}
              disabled={isAnalysisLoading || !isEnded || !transcript?.text.trim()}
              className="inline-flex h-9 items-center justify-center rounded-md bg-slate-950 px-3 text-xs font-medium text-white transition-colors hover:bg-slate-800 disabled:cursor-not-allowed disabled:bg-slate-300"
            >
              {isAnalysisLoading
                ? "分析中..."
                : analysis
                  ? "重新生成分析"
                  : "生成路演表现分析"}
            </button>
          </div>

          {!isEnded ? (
            <p
              className={
                isBigScreenMode
                  ? "mt-3 rounded-md border border-slate-700 bg-slate-950/60 p-3 text-xs leading-5 text-slate-300"
                  : "mt-3 rounded-md border border-slate-200 bg-slate-50 p-3 text-xs leading-5 text-slate-600"
              }
            >
              结束路演后可生成分析。
            </p>
          ) : !transcript?.text.trim() ? (
            <p
              className={
                isBigScreenMode
                  ? "mt-3 rounded-md border border-slate-700 bg-slate-950/60 p-3 text-xs leading-5 text-slate-300"
                  : "mt-3 rounded-md border border-slate-200 bg-slate-50 p-3 text-xs leading-5 text-slate-600"
              }
            >
              请先保存转写文本，再生成路演表现分析。
            </p>
          ) : null}

          {analysisMessage ? (
            <p
              className={
                isBigScreenMode
                  ? "mt-3 text-xs leading-5 text-slate-300"
                  : "mt-3 text-xs leading-5 text-slate-600"
              }
            >
              {analysisMessage}
            </p>
          ) : null}

          {analysis?.status === "FAILED" ? (
            <p className="mt-3 rounded-md border border-red-200 bg-red-50 p-3 text-xs leading-5 text-red-700">
              {analysis.errorMessage ?? "路演表现分析生成失败。"}
            </p>
          ) : null}

          {analysis?.status === "COMPLETED" ? (
            <div className="mt-4 grid gap-4 text-sm">
              <div
                className={
                  isBigScreenMode
                    ? "rounded-md border border-slate-700 bg-slate-950/60 p-3"
                    : "rounded-md border border-slate-200 bg-slate-50 p-3"
                }
              >
                <div className="flex items-center justify-between gap-3">
                  <span className={mutedTextClassName}>总体评分</span>
                  <strong
                    className={
                      isBigScreenMode
                        ? "text-xl font-semibold text-white"
                        : "text-xl font-semibold text-slate-950"
                    }
                  >
                    {analysis.overallScore ?? "-"} / 100
                  </strong>
                </div>
                <p
                  className={
                    isBigScreenMode
                      ? "mt-3 leading-6 text-slate-100"
                      : "mt-3 leading-6 text-slate-700"
                  }
                >
                  {analysis.summary}
                </p>
              </div>

              <div className="grid gap-3">
                <h3 className={secondaryTitleClassName}>优点</h3>
                <ul className="grid gap-2">
                  {analysis.strengths.map((item) => (
                    <li key={item} className={transcriptTextClassName}>
                      {item}
                    </li>
                  ))}
                </ul>
              </div>

              <div className="grid gap-3">
                <h3 className={secondaryTitleClassName}>问题</h3>
                <ul className="grid gap-2">
                  {analysis.weaknesses.map((item) => (
                    <li key={item} className={transcriptTextClassName}>
                      {item}
                    </li>
                  ))}
                </ul>
              </div>

              <div className="grid gap-3">
                <h3 className={secondaryTitleClassName}>改进建议</h3>
                <ul className="grid gap-2">
                  {analysis.suggestions.map((item) => (
                    <li key={item} className={transcriptTextClassName}>
                      {item}
                    </li>
                  ))}
                </ul>
              </div>

              <div className="grid gap-3">
                <h3 className={secondaryTitleClassName}>内容覆盖情况</h3>
                <div className="grid gap-2">
                  {analysis.coverage.map((item) => (
                    <div
                      key={item.item}
                      className={
                        isBigScreenMode
                          ? "rounded-md border border-slate-700 bg-slate-950/60 p-3"
                          : "rounded-md border border-slate-200 bg-white p-3"
                      }
                    >
                      <div className="flex items-center justify-between gap-3">
                        <span className={valueTextClassName}>{item.item}</span>
                        <span className={mutedTextClassName}>
                          {getCoverageLabel(item.covered)}
                        </span>
                      </div>
                      <p className={`${transcriptTextClassName} mt-2`}>
                        证据：{item.evidence}
                      </p>
                      <p className={`${transcriptTextClassName} mt-1`}>
                        建议：{item.suggestion}
                      </p>
                    </div>
                  ))}
                </div>
              </div>

              <div className="grid gap-3">
                <h3 className={secondaryTitleClassName}>时间节奏</h3>
                <p className={transcriptTextClassName}>
                  {stringifyAnalysisValue(analysis.timing.assessment)}
                </p>
                <p className={transcriptTextClassName}>
                  建议：{stringifyAnalysisValue(analysis.timing.suggestion)}
                </p>
              </div>

              <div className="grid gap-3">
                <h3 className={secondaryTitleClassName}>翻页节奏</h3>
                <p className={transcriptTextClassName}>
                  {stringifyAnalysisValue(analysis.slideSync.assessment)}
                </p>
                <p className={transcriptTextClassName}>
                  建议：{stringifyAnalysisValue(analysis.slideSync.suggestion)}
                </p>
              </div>

              <div className="grid gap-3">
                <h3 className={secondaryTitleClassName}>可能被追问的问题</h3>
                <ul className="grid gap-2">
                  {analysis.riskQuestions.map((item) => (
                    <li key={item} className={transcriptTextClassName}>
                      {item}
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          ) : null}
        </section>
        ) : null}

      </aside>

      {showRecordingPrepDialog && status === "CREATED" ? (
        <div className="fixed inset-0 z-[60] grid place-items-center bg-slate-950/70 px-4">
          <section className="w-full max-w-lg rounded-lg border border-slate-200 bg-white p-6 shadow-2xl">
            <p className="text-xs font-medium text-slate-500">录音准备</p>
            <h2 className="mt-2 text-xl font-semibold text-slate-950">
              开始前请确认麦克风
            </h2>
            {showRecordingOptOutConfirm ? (
              <>
                <p className="mt-4 text-sm leading-6 text-slate-600">
                  确认不启用录音？本次路演将无法生成语音转写和表达分析，仅记录翻页和用时。
                </p>
                <div className="mt-6 flex flex-col gap-2 sm:flex-row sm:justify-end">
                  <button
                    type="button"
                    onClick={() => setShowRecordingOptOutConfirm(false)}
                    className="inline-flex h-10 items-center justify-center rounded-md border border-slate-300 bg-white px-4 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-50"
                  >
                    返回开启麦克风
                  </button>
                  <button
                    type="button"
                    onClick={confirmRecordingOptOut}
                    className="inline-flex h-10 items-center justify-center rounded-md bg-slate-950 px-4 text-sm font-medium text-white transition-colors hover:bg-slate-800"
                  >
                    确认不录音
                  </button>
                </div>
              </>
            ) : (
              <>
                <p className="mt-4 text-sm leading-6 text-slate-600">
                  为保证训练顺利进行，本次路演建议开启麦克风录音。请先允许麦克风权限，系统将在正式开始路演后自动录制。
                </p>
                {recordingMessage ? (
                  <p className="mt-4 rounded-md border border-slate-200 bg-slate-50 p-3 text-sm leading-6 text-slate-600">
                    {recordingMessage}
                  </p>
                ) : null}
                <div className="mt-6 flex flex-col gap-2 sm:flex-row sm:justify-end">
                  <button
                    type="button"
                    onClick={() => setShowRecordingOptOutConfirm(true)}
                    className="inline-flex h-10 items-center justify-center rounded-md border border-slate-300 bg-white px-4 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-50"
                  >
                    暂不录音，继续训练
                  </button>
                  <button
                    type="button"
                    onClick={() => void prepareRecording()}
                    className="inline-flex h-10 items-center justify-center rounded-md bg-slate-950 px-4 text-sm font-medium text-white transition-colors hover:bg-slate-800"
                  >
                    开启麦克风并准备训练
                  </button>
                </div>
              </>
            )}
          </section>
        </div>
      ) : null}

      {showRecordingReenableConfirm && status === "CREATED" ? (
        <div className="fixed inset-0 z-[60] grid place-items-center bg-slate-950/70 px-4">
          <section className="w-full max-w-lg rounded-lg border border-slate-200 bg-white p-6 shadow-2xl">
            <p className="text-xs font-medium text-slate-500">重新启用录音</p>
            <h2 className="mt-2 text-xl font-semibold text-slate-950">
              本轮将启用录音
            </h2>
            <p className="mt-4 text-sm leading-6 text-slate-600">
              启用后，本轮路演将进行录音并在结束后保存。是否继续？
            </p>
            <div className="mt-6 flex flex-col gap-2 sm:flex-row sm:justify-end">
              <button
                type="button"
                onClick={() => setShowRecordingReenableConfirm(false)}
                className="inline-flex h-10 items-center justify-center rounded-md border border-slate-300 bg-white px-4 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-50"
              >
                取消
              </button>
              <button
                type="button"
                onClick={() => {
                  setShowRecordingReenableConfirm(false);
                  void prepareRecording();
                }}
                className="inline-flex h-10 items-center justify-center rounded-md bg-slate-950 px-4 text-sm font-medium text-white transition-colors hover:bg-slate-800"
              >
                继续启用录音
              </button>
            </div>
          </section>
        </div>
      ) : null}
    </div>
    </>
  );
}
