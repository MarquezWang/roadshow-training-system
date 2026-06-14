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
import { PREFERRED_DEVICE_KEY } from "@/lib/use-audio-input";

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
  files: QaFile[];
  dynamicFollowupExperiment: boolean;
}>;

type QaPhase = "PREPARING" | "READY" | "ASKING" | "COUNTDOWN" | "ANSWERING" | "SAVING" | "DONE";
type QaRecordingStatus = "idle" | "recording" | "saving" | "saved" | "disabled";
type PreviewMode = "standard" | "compatible";

const qaLimitSec = 3 * 60;
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

function getPreferredAudioConstraints(): MediaStreamConstraints {
  if (typeof window === "undefined") return { audio: true };
  try {
    const deviceId = localStorage.getItem(PREFERRED_DEVICE_KEY);
    if (deviceId) {
      return { audio: { deviceId: { exact: deviceId } } };
    }
  } catch {
    // localStorage 不可用
  }
  return { audio: true };
}

function estimateQuestionSpeechMs(text: string) {
  const chineseCharCount = Array.from(text.trim()).length;

  return Math.min(28000, Math.max(5000, chineseCharCount * 170));
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

function chooseJudgeVoice(voices: SpeechSynthesisVoice[]) {
  if (voices.length === 0) return null;

  // 精确匹配最优先
  const exactMatch = voices.find(
    (v) => v.name === "Microsoft Xiaoyi Online (Natural) - Chinese (Mainland)",
  );
  if (exactMatch) return exactMatch;

  // 降级 1：zh-CN 中文语音
  const zhCNVoices = voices.filter((v) => v.lang === "zh-CN");
  if (zhCNVoices.length > 0) {
    // 在 zh-CN 中找包含 Xiaoyi 的
    const xiaoyiZhCN = zhCNVoices.find(
      (v) => v.name.toLowerCase().includes("xiaoyi"),
    );
    if (xiaoyiZhCN) return xiaoyiZhCN;

    // 在 zh-CN 中找包含 Natural 的
    const naturalZhCN = zhCNVoices.find(
      (v) => v.name.toLowerCase().includes("natural"),
    );
    if (naturalZhCN) return naturalZhCN;

    // 降级：zh-CN 第一个
    return zhCNVoices[0];
  }

  // 降级 2：名称中包含 Xiaoyi（不限语言）
  const xiaoyiAny = voices.find(
    (v) => v.name.toLowerCase().includes("xiaoyi"),
  );
  if (xiaoyiAny) return xiaoyiAny;

  // 降级 3：中文语音（lang 含 zh）
  const zhVoice = voices.find(
    (v) => v.lang.includes("zh") || v.lang.includes("chinese"),
  );
  if (zhVoice) return zhVoice;

  // 降级 4：浏览器默认
  return voices[0] ?? null;
}

export function TrainingQaClient({
  sessionId,
  projectName,
  initialStatus,
  initialRemainingSec,
  initialQuestions,
  previewFile,
  dynamicFollowupExperiment,
}: TrainingQaClientProps) {
  const router = useRouter();
  const initialQuestionIndex = findInitialQuestionIndex(initialQuestions);
  const [status, setStatus] = useState(initialStatus);
  const [qaPhase, setQaPhase] = useState<QaPhase>(
    initialStatus === "QAING" ? "ASKING" : "PREPARING",
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
  const [message, setMessage] = useState("");
  const [isGenerating, setIsGenerating] = useState(false);
  const [generateError, setGenerateError] = useState<string | null>(null);
  const autoGenerateRef = useRef(false);
  const generateTimeoutRef = useRef<number | null>(null);
  const [isStarting, setIsStarting] = useState(false);
  const [preAnswerOverlay, setPreAnswerOverlay] = useState<number | null>(null);
  const [isGuardResolved, setIsGuardResolved] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  // 答辩准备页进度 (0-100)
  const [preparingProgress, setPreparingProgress] = useState(0);
  const preparingTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const preparingStartRef = useRef<number>(0);
  const [qaRecordingStatus, setQaRecordingStatus] =
    useState<QaRecordingStatus>("idle");
  const [qaRecordingMessage, setQaRecordingMessage] = useState("");
  const [pageIndex, setPageIndex] = useState(0);
  const [totalPages, setTotalPages] = useState<number | null>(null);
  const [isPdfLoading, setIsPdfLoading] = useState(Boolean(previewFile));
  const [pdfError, setPdfError] = useState("");
  const [previewMode, setPreviewMode] = useState<PreviewMode>("standard");
  const [pdfDocument, setPdfDocument] = useState<PDFDocumentProxy | null>(null);
  const currentAnswerStartedAtRef = useRef<Date | null>(
    initialStatus === "QAING" ? new Date() : null,
  );
  const answerPhaseStartedMsRef = useRef<number | null>(null);
  const answerElapsedBeforePhaseRef = useRef(
    Math.max(0, qaLimitSec - Math.min(initialRemainingSec, qaLimitSec)),
  );
  const speechTimeoutRef = useRef<number | null>(null);
  const countdownIntervalRef = useRef<number | null>(null);
  const hasAutoEndedRef = useRef(false);
  const hasResumedQaingRef = useRef(false);
  const isCompletingNormallyRef = useRef(false);
  const hasMoveOnRef = useRef(false);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const recordingChunksRef = useRef<Blob[]>([]);
  const recordingStartedAtRef = useRef<Date | null>(null);
  const recordingMimeTypeRef = useRef("");
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const previewContainerRef = useRef<HTMLDivElement | null>(null);
  const currentQuestion = questions[currentQuestionIndex] ?? null;
  const isQaing = status === "QAING";
  const remainingSec = Math.max(0, qaLimitSec - usedAnswerSec);
  const isLastQuestion = currentQuestionIndex >= questions.length - 1;
  const shouldFinishAfterCurrent =
    isLastQuestion || (remainingSec < 30 && !isLastQuestion);
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

  // 答辩准备页：进度条动画约 13 秒，结束后进入 READY 或 ASKING 阶段
  useEffect(() => {
    if (qaPhase !== "PREPARING") return;

    const PREPARING_DURATION_MS = 13_000;
    const TICK_INTERVAL_MS = 50;
    preparingStartRef.current = performance.now();

    preparingTimerRef.current = setInterval(() => {
      const elapsed = performance.now() - preparingStartRef.current;
      const fraction = Math.min(elapsed / PREPARING_DURATION_MS, 1);

      // 分段进度：0→35% 快，35→55% 缓，55→85% 流畅，85→100% 收尾
      let progress: number;
      const t = fraction;
      if (t < 0.2) {
        progress = t * 175; // 0 → 35
      } else if (t < 0.55) {
        progress = 35 + (t - 0.2) * 57.1; // 35 → 55
      } else if (t < 0.88) {
        progress = 55 + (t - 0.55) * 90.9; // 55 → 85
      } else {
        progress = 85 + (t - 0.88) * 125; // 85 → 100
      }

      setPreparingProgress(Math.min(Math.round(progress), 100));

      if (elapsed >= PREPARING_DURATION_MS) {
        if (preparingTimerRef.current) {
          clearInterval(preparingTimerRef.current);
          preparingTimerRef.current = null;
        }
        setPreparingProgress(100);
        setQaPhase(initialStatus === "QAING" ? "ASKING" : "READY");
      }
    }, TICK_INTERVAL_MS);

    return () => {
      if (preparingTimerRef.current) {
        clearInterval(preparingTimerRef.current);
        preparingTimerRef.current = null;
      }
    };
  }, [qaPhase, initialStatus]);

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

  function clearSpeechTimer() {
    if (speechTimeoutRef.current !== null) {
      window.clearTimeout(speechTimeoutRef.current);
      speechTimeoutRef.current = null;
    }
  }

  function clearCountdownTimer() {
    if (countdownIntervalRef.current !== null) {
      window.clearInterval(countdownIntervalRef.current);
      countdownIntervalRef.current = null;
    }
  }

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
  }, [qaPhase, usedAnswerSec]);

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
    if (!pdfDocument || !canvasRef.current || previewMode !== "standard") {
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
  }, [currentPageNumber, pdfDocument, previewMode]);

  useEffect(() => {
    const container = previewContainerRef.current;

    if (!container || !previewFile || previewMode !== "standard") {
      return;
    }

    const observer = new ResizeObserver(() => {
      setPageIndex((currentIndex) => currentIndex);
    });

    observer.observe(container);

    return () => observer.disconnect();
  }, [previewFile, previewMode]);

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

  const startQuestionRecording = useCallback(async () => {
    if (
      typeof navigator === "undefined" ||
      !navigator.mediaDevices?.getUserMedia ||
      typeof MediaRecorder === "undefined"
    ) {
      setQaRecordingStatus("disabled");
      setQaRecordingMessage("本题未启用录音。");
      return;
    }

    const mimeType = getSupportedRecordingMimeType();

    if (!mimeType) {
      setQaRecordingStatus("disabled");
      setQaRecordingMessage("当前浏览器不支持答辩录音，本题未启用录音。");
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia(getPreferredAudioConstraints());
      const recorder = new MediaRecorder(stream, { mimeType });

      recordingChunksRef.current = [];
      recordingStartedAtRef.current = new Date();
      recordingMimeTypeRef.current = mimeType;
      mediaStreamRef.current = stream;
      mediaRecorderRef.current = recorder;
      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          recordingChunksRef.current.push(event.data);
        }
      };
      recorder.start();
      setQaRecordingStatus("recording");
      setQaRecordingMessage("本题录音中。");
    } catch {
      setQaRecordingStatus("disabled");
      setQaRecordingMessage("本题未启用录音。");
    }
  }, []);

  const stopAndUploadCurrentRecording = useCallback(async () => {
    const recorder = mediaRecorderRef.current;
    const stream = mediaStreamRef.current;

    if (!recorder || recorder.state === "inactive") {
      stream?.getTracks().forEach((track) => track.stop());
      mediaRecorderRef.current = null;
      mediaStreamRef.current = null;
      return null;
    }

    setQaRecordingStatus("saving");

    const stoppedAt = new Date();
    const startedAt = recordingStartedAtRef.current;
    const mimeType = recordingMimeTypeRef.current || recorder.mimeType;
    const stopped = new Promise<void>((resolve) => {
      recorder.onstop = () => resolve();
    });

    recorder.stop();
    await stopped;
    stream?.getTracks().forEach((track) => track.stop());
    mediaRecorderRef.current = null;
    mediaStreamRef.current = null;

    if (recordingChunksRef.current.length === 0 || !mimeType) {
      setQaRecordingStatus("disabled");
      setQaRecordingMessage("本题未保存录音。");
      return null;
    }

    const blob = new Blob(recordingChunksRef.current, { type: mimeType });
    const formData = new FormData();
    const durationSec = startedAt
      ? Math.max(0, Math.round((stoppedAt.getTime() - startedAt.getTime()) / 1000))
      : null;

    formData.append(
      "file",
      blob,
      `qa-answer.${getRecordingFileExtension(mimeType)}`,
    );
    formData.append("phase", "QA");
    formData.append("startedAt", startedAt?.toISOString() ?? "");
    formData.append("endedAt", stoppedAt.toISOString());

    if (durationSec !== null) {
      formData.append("durationSec", String(durationSec));
    }

    try {
      const response = await fetch(`/training/${sessionId}/recordings`, {
        method: "POST",
        body: formData,
      });
      const body = (await response.json().catch(() => null)) as {
        recording?: { id?: string };
        error?: string;
      } | null;

      if (!response.ok || !body?.recording?.id) {
        throw new Error(body?.error ?? "本题录音保存失败。");
      }

      setQaRecordingStatus("saved");
      setQaRecordingMessage("本题录音已保存。");

      // 后台触发转写，不阻塞 UI
      void fetch(
        `/training/${sessionId}/recordings/${body.recording.id}/transcribe`,
        { method: "POST" },
      ).catch(() => {
        // 转写失败不影响答题流程
      });

      return body.recording.id;
    } catch (error) {
      setQaRecordingStatus("disabled");
      setQaRecordingMessage(
        error instanceof Error ? error.message : "本题录音保存失败。",
      );
      return null;
    }
  }, [sessionId]);

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
    setQaPhase("ANSWERING");
    // 确保评委语音已停止，避免被录进用户回答
    window.speechSynthesis?.cancel();
    await startQuestionRecording();
  }, [startQuestionRecording, usedAnswerSec]);

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
  }, [beginAnswering]);

  function getVoicesWithTimeout(timeoutMs = 3000): Promise<SpeechSynthesisVoice[]> {
  const synth = window.speechSynthesis;
  const voices = synth.getVoices();
  if (voices.length > 0) {
    return Promise.resolve(voices);
  }

  return new Promise<SpeechSynthesisVoice[]>((resolve) => {
    const timeout = window.setTimeout(() => {
      window.speechSynthesis.removeEventListener("voiceschanged", handler);
      resolve(window.speechSynthesis.getVoices());
    }, timeoutMs);

    function handler() {
      window.clearTimeout(timeout);
      resolve(window.speechSynthesis.getVoices());
    }

    window.speechSynthesis.addEventListener("voiceschanged", handler, {
      once: true,
    });
  });
}

function buildMoveOn(
  hasMovedOnRef: { current: boolean },
  beginPreAnswerCountdown: () => void,
) {
  return () => {
    if (hasMovedOnRef.current) {
      return;
    }
    hasMovedOnRef.current = true;
    beginPreAnswerCountdown();
  };
}

const beginJudgeQuestion = useCallback(
    (questionIndex: number) => {
      const question = questions[questionIndex];

      if (!question) {
        return;
      }

      clearSpeechTimer();
      clearCountdownTimer();
      window.speechSynthesis?.cancel();
      hasMoveOnRef.current = false;
      setCurrentQuestionIndex(questionIndex);
      setQaPhase("ASKING");
      setMessage("");
      setQaRecordingStatus("idle");
      setQaRecordingMessage("");

      if (
        typeof window === "undefined" ||
        !("speechSynthesis" in window) ||
        typeof SpeechSynthesisUtterance === "undefined"
      ) {
        setMessage("当前浏览器不支持语音提问，已切换为文字提问。");
        beginPreAnswerCountdown();
        return;
      }

      const utterance = new SpeechSynthesisUtterance(question.questionText);
      const moveOn = buildMoveOn(hasMoveOnRef, beginPreAnswerCountdown);

      utterance.lang = "zh-CN";
      utterance.rate = 1.15;
      utterance.pitch = 0.92;
      utterance.onend = moveOn;
      utterance.onerror = () => {
        setMessage("语音提问不可用，请点击\u201c查看问题文字\u201d确认题目。");
        moveOn();
      };

      void (async () => {
        const voices = await getVoicesWithTimeout(3000);
        const selectedVoice = chooseJudgeVoice(voices);
        if (selectedVoice) {
          utterance.voice = selectedVoice;
          utterance.lang = selectedVoice.lang;
          devLog(`[QA TTS] 选中语音：${selectedVoice.name} (${selectedVoice.lang})`);
          try {
            localStorage.setItem("qa-preferred-voice", selectedVoice.name);
          } catch {
            // localStorage 不可用
          }
        }
        window.speechSynthesis.speak(utterance);
      })();

      // setTimeout 仅作为兜底保护，如果语音仍在播放则不前进
      function scheduleFallback() {
        speechTimeoutRef.current = window.setTimeout(() => {
          if (hasMoveOnRef.current) {
            return;
          }
          if (window.speechSynthesis.speaking || window.speechSynthesis.pending) {
            // 仍在播放，延后再检查
            scheduleFallback();
            return;
          }
          moveOn();
        }, estimateQuestionSpeechMs(question.questionText));
      }

      scheduleFallback();
    },
    [beginPreAnswerCountdown, questions],
  );

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
      window.speechSynthesis?.cancel();

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
      clearSpeechTimer();
      clearCountdownTimer();
      window.speechSynthesis?.cancel();
      if (mediaRecorderRef.current?.state === "recording") {
        mediaRecorderRef.current.stop();
      }
      mediaStreamRef.current?.getTracks().forEach((track) => track.stop());
    };
  }, []);

  const generateQuestions = useCallback(async () => {
    devLog("[qa:client] manual retry generate", { sessionId });
    setIsGenerating(true);
    setGenerateError(null);
    setMessage("");

    try {
      const response = await fetch(
        `/training/${sessionId}/qa/questions/generate`,
        {
          method: "POST",
        },
      );
      const body = (await response.json().catch(() => null)) as {
        questions?: TrainingQaQuestion[];
        error?: string;
        generating?: boolean;
        lockAgeMs?: number;
        message?: string;
      } | null;

      devLog("[qa:client] manual retry POST response", {
        sessionId,
        status: response.status,
        ok: response.ok,
        questionsCount: body?.questions?.length ?? 0,
        generating: body?.generating ?? false,
        error: body?.error ?? null,
      });

      if (!response.ok) {
        // 409: 正在生成中（有锁），提示用户等待
        if (response.status === 409 && body?.generating) {
          setMessage(
            body?.message ?? "评委问题准备中，请稍候……",
          );
          // 保持 isGenerating = true，让轮询 effect 继续等待
          // 注意：不手动设置 isGenerating = false，让 effect 自然处理
          return;
        }
        throw new Error(body?.error ?? "答辩问题生成失败。");
      }

      setQuestions(body?.questions ?? []);
      setCurrentQuestionIndex(0);
      setMessage("答辩问题已生成。开始前不会展示完整题目。");
      if (generateTimeoutRef.current !== null) {
        window.clearTimeout(generateTimeoutRef.current);
        generateTimeoutRef.current = null;
      }
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : "答辩问题生成失败。";
      setGenerateError(errorMessage);
      setMessage(errorMessage);
    } finally {
      setIsGenerating(false);
    }
  }, [sessionId]);

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
        setGenerateError(errorMsg);
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

    setRevealedQuestionIds((current) => {
      const next = new Set(current);

      next.add(currentQuestion.id);

      return next;
    });
  }

  const phaseLabel =
    qaPhase === "PREPARING"
      ? "答辩准备中"
      : qaPhase === "ASKING"
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
  const recordingLabel: Record<QaRecordingStatus, string> = {
    idle: "录音未开始",
    recording: "本题录音中",
    saving: "本题录音保存中",
    saved: "本题录音已保存",
    disabled: "本题未启用录音",
  };
  const mainButtonLabel = isLastQuestion
    ? "完成答辩"
    : remainingSec < 30
      ? "保存本题并完成答辩"
      : "回答完毕，进入下一题";

  return (
    <>
      {!isGuardResolved ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70">
          <p className="text-xl font-semibold text-white">正在结束训练...</p>
        </div>
      ) : null}
      {preAnswerOverlay !== null ? (
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
      {qaPhase === "PREPARING" ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/90 backdrop-blur-sm">
          <div className="w-full max-w-md px-6 text-center">
            {/* 顶部小标签 */}
            <span className="inline-block rounded-full border border-slate-600 bg-slate-900/80 px-3 py-1 text-xs font-medium text-slate-400">
              模拟答辩
            </span>

            {/* 主标题 */}
            <h2 className="mt-6 text-2xl font-bold text-white">
              答辩准备中
            </h2>

            {/* 副标题 */}
            <p className="mt-3 text-base font-medium text-slate-200">
              路演已结束，答辩即将开始
            </p>

            {/* 说明文字 */}
            <p className="mt-5 text-sm leading-6 text-slate-400">
              系统正在整理本轮路演内容，并同步准备评委提问。请保持麦克风开启，稍后进入答辩环节。
            </p>

            {/* 动态加载点 */}
            <div className="mt-6 flex items-center justify-center gap-1.5">
              <span className="h-2 w-2 animate-pulse rounded-full bg-white/60" style={{ animationDelay: "0ms" }} />
              <span className="h-2 w-2 animate-pulse rounded-full bg-white/60" style={{ animationDelay: "200ms" }} />
              <span className="h-2 w-2 animate-pulse rounded-full bg-white/60" style={{ animationDelay: "400ms" }} />
            </div>

            {/* 进度条 */}
            <div className="mx-auto mt-6 h-2 w-full overflow-hidden rounded-full bg-slate-700">
              <div
                className="h-full rounded-full bg-gradient-to-r from-blue-500 to-white transition-[width] duration-75 ease-linear"
                style={{ width: `${preparingProgress}%` }}
              />
            </div>

            {/* 麦克风提示 */}
            <p className="mt-8 text-xs text-slate-500">
              麦克风已保持开启
            </p>
          </div>
        </div>
      ) : null}
      <div className="grid h-screen w-full gap-3 overflow-hidden bg-slate-950 text-white lg:grid-cols-[minmax(0,1fr)_300px]">
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
                <div className="flex flex-wrap items-center gap-2">
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
            {isGenerating || qaPhase === "PREPARING" ? (
              <button
                type="button"
                disabled
                className="inline-flex h-10 items-center justify-center rounded-md bg-white px-4 text-sm font-medium text-slate-950 transition-colors disabled:cursor-not-allowed disabled:bg-slate-700 disabled:text-slate-400"
              >
                {qaPhase === "PREPARING" ? "准备中……" : "评委问题准备中..."}
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
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <MicrophoneStatusBar />
            <button
              type="button"
              onClick={() => changeMaterialPage("PREV")}
              disabled={!canGoPrev}
              className="inline-flex h-10 items-center justify-center rounded-md border border-slate-600 bg-slate-900 px-4 text-sm font-medium text-white transition-colors hover:bg-slate-800 disabled:cursor-not-allowed disabled:border-slate-800 disabled:bg-slate-900/50 disabled:text-slate-500"
            >
              上一页
            </button>
            <button
              type="button"
              onClick={() => changeMaterialPage("NEXT")}
              disabled={!canGoNext}
              className="inline-flex h-10 items-center justify-center rounded-md border border-slate-600 bg-slate-900 px-4 text-sm font-medium text-white transition-colors hover:bg-slate-800 disabled:cursor-not-allowed disabled:border-slate-800 disabled:bg-slate-900/50 disabled:text-slate-500"
            >
              下一页
            </button>
          </div>
        </div>
      </section>

      <aside className="grid min-h-0 gap-3 overflow-hidden lg:grid-rows-[auto_minmax(0,1fr)]">
        <section className="rounded-lg border border-slate-700 bg-slate-900/90 p-4 shadow-sm">
          <h3 className="text-sm font-semibold text-white">答辩信息</h3>
          <dl className="mt-4 grid gap-3 text-sm">
            <div className="flex items-center justify-between border-b border-slate-700 pb-3">
              <dt className="text-slate-300">当前题号</dt>
              <dd className="font-medium text-white">
                {questions.length > 0 && currentQuestion
                  ? `${currentQuestion.orderIndex} / ${questions.length}`
                  : `0 / ${questions.length}`}
              </dd>
            </div>
            <div className="flex items-center justify-between border-b border-slate-700 pb-3">
              <dt className="text-slate-300">剩余答题时间</dt>
              <dd
                className={
                  remainingSec <= 30
                    ? "font-semibold text-red-300"
                    : "font-medium text-white"
                }
              >
                {formatDuration(remainingSec)}
              </dd>
            </div>
            <div className="flex items-center justify-between border-b border-slate-700 pb-3">
              <dt className="text-slate-300">答辩状态</dt>
              <dd className="font-medium text-white">{status}</dd>
            </div>
            <div className="flex items-center justify-between border-b border-slate-700 pb-3">
              <dt className="text-slate-300">录音状态</dt>
              <dd className="font-medium text-white">
                {recordingLabel[qaRecordingStatus]}
              </dd>
            </div>
            <div className="flex items-center justify-between">
              <dt className="text-slate-300">查看问题文字</dt>
              <dd className="font-medium text-white">
                {currentQuestion && revealedQuestionIds.has(currentQuestion.id)
                  ? "是"
                  : "否"}
              </dd>
            </div>
          </dl>
        </section>

        <section className="min-h-0 overflow-y-auto rounded-lg border border-slate-700 bg-slate-900/90 p-4 shadow-sm">
          <p className="text-sm font-medium text-slate-400">语音评委答辩舱</p>
          <h3 className="mt-2 text-xl font-semibold text-white">
            {phaseLabel}
          </h3>

          {qaPhase === "PREPARING" ? (
            <div className="mt-5 rounded-md border border-slate-700 bg-slate-950/60 p-6 text-center">
              <p className="text-sm text-slate-500">答辩准备中，请稍候...</p>
            </div>
          ) : !isQaing ? (
            <div className="mt-5 grid gap-4">
              <div className="rounded-md border border-slate-700 bg-slate-950/60 p-4">
                <h4 className="text-sm font-semibold text-white">答辩规则</h4>
                <ul className="mt-3 grid gap-2 text-sm leading-6 text-slate-300">
                  <li>总答题时间 3 分钟，评委提问和 3、2、1 期间不扣时。</li>
                  <li>系统一次只进入一道题。</li>
                  <li>问题默认语音播报，可按需查看文字。</li>
                  <li>回答完毕后点击进入下一题，最后一题点击完成答辩。</li>
                </ul>
              </div>

              {isGenerating ? (
                <div className="rounded-md border border-slate-700 bg-slate-950/60 p-6 text-center">
                  {dynamicFollowupExperiment ? (
                    <>
                      <p className="text-base font-semibold text-white">
                        评委正在生成本轮路演追问
                      </p>
                      <p className="mt-2 text-sm leading-6 text-slate-400">
                        系统正在根据你的路演内容生成第一道追问。如果转写或生成超时，将自动使用常规答辩问题。
                      </p>
                    </>
                  ) : (
                    <>
                      <p className="text-base font-semibold text-white">
                        评委问题准备中，请稍候……
                      </p>
                      <p className="mt-2 text-sm leading-6 text-slate-400">
                        正在阅读项目材料与评分标准，生成答辩问题
                      </p>
                    </>
                  )}
                </div>
              ) : questions.length > 0 ? (
                <div className="rounded-md border border-slate-700 bg-slate-950/60 p-6 text-center">
                  <p className="text-base font-semibold text-white">
                    AI评委已准备好提问
                  </p>
                  <p className="mt-2 text-sm leading-6 text-slate-400">
                    已生成 {questions.length} 道问题。开始前不展示完整题目正文。
                  </p>
                </div>
              ) : generateError ? (
                <div className="rounded-md border border-red-700/50 bg-red-950/30 p-6 text-center">
                  <p className="text-base font-semibold text-red-200">
                    问题生成失败
                  </p>
                  <p className="mt-2 text-sm leading-6 text-red-300">
                    {generateError}
                  </p>
                  <button
                    type="button"
                    onClick={() => void generateQuestions()}
                    disabled={isGenerating}
                    className="mt-4 inline-flex h-8 items-center justify-center rounded border border-red-700/50 bg-transparent px-3 text-xs font-medium text-red-300 transition-colors hover:bg-red-950/50 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    重试生成问题
                  </button>
                </div>
              ) : null}

              {isGenerating || qaPhase === "PREPARING" ? (
                <p className="text-center text-sm text-slate-500">
                  {qaPhase === "PREPARING"
                    ? "答辩准备中，请稍候..."
                    : "评委问题准备中，请稍候..."}
                </p>
              ) : null}
            </div>
          ) : currentQuestion ? (
            <div className="mt-5 grid gap-4">
              {qaPhase === "ASKING" ? (
                <div className="rounded-md border border-slate-700 bg-slate-950/60 p-4 text-center">
                  <p className="text-base font-semibold text-white">
                    评委正在提问，请认真听题
                  </p>
                  <p className="mt-2 text-sm leading-6 text-slate-300">
                    第 {currentQuestion.orderIndex} 题语音播报中。提问结束后将进入
                    3、2、1，期间不扣答题时间。
                  </p>
                </div>
              ) : null}

              {qaPhase === "ANSWERING" ? (
                <div className="rounded-md border border-slate-700 bg-slate-950/60 p-4">
                  <p className="text-base font-semibold text-white">
                    请开始口头回答
                  </p>
                  <p className="mt-2 text-sm leading-6 text-slate-300">
                    仅回答期间扣减答题时间。答完后点击下方按钮保存本题用时和录音。
                  </p>
                  {remainingSec < 30 && !isLastQuestion ? (
                    <p className="mt-3 rounded-md border border-amber-400/40 bg-amber-500/10 p-3 text-sm leading-6 text-amber-100">
                      剩余答题时间较少，建议保存本题并完成答辩。
                    </p>
                  ) : null}
                </div>
              ) : null}

              {qaPhase === "SAVING" ? (
                <div className="rounded-md border border-slate-700 bg-slate-950/60 p-4 text-sm leading-6 text-slate-300">
                  正在保存当前题用时和录音...
                </div>
              ) : null}

              <div className="rounded-md border border-slate-700 bg-slate-950/60 p-4">
                <div className="flex items-center justify-between gap-3">
                  <p className="text-xs font-medium uppercase text-slate-400">
                    Q{currentQuestion.orderIndex} /{" "}
                    {currentQuestion.questionType ?? "QUESTION"}
                  </p>
                  <button
                    type="button"
                    onClick={revealQuestionText}
                    className="inline-flex h-8 items-center justify-center rounded-md border border-slate-600 bg-slate-900 px-3 text-xs font-medium text-white transition-colors hover:bg-slate-800"
                  >
                    查看问题文字
                  </button>
                </div>

                {revealedQuestionIds.has(currentQuestion.id) ? (
                  <div className="mt-3 rounded-md border border-slate-700 bg-slate-900 p-3">
                    {currentQuestion.source === "DYNAMIC_FOLLOWUP" ? (
                      <span className="mb-1 inline-block rounded bg-blue-900/60 px-2 py-0.5 text-xs font-medium text-blue-200">
                        基于本轮路演追问
                      </span>
                    ) : null}
                    <p className="text-sm font-semibold leading-6 text-white">
                      {currentQuestion.questionText}
                    </p>
                    {currentQuestion.basis ? (
                      <p className="mt-2 text-xs leading-5 text-slate-400">
                        依据：{currentQuestion.basis}
                      </p>
                    ) : null}
                  </div>
                ) : (
                  <p className="mt-3 text-sm leading-6 text-slate-300">
                    问题文字默认隐藏。若没听清，可点击“查看问题文字”。
                  </p>
                )}
              </div>

            </div>) : null}

          {message ? (
            <p className="mt-4 rounded-md border border-slate-700 bg-slate-950/60 p-3 text-sm leading-6 text-slate-300">
              {message}
            </p>
          ) : null}
          {qaRecordingMessage ? (
            <p className="mt-3 rounded-md border border-slate-700 bg-slate-950/60 p-3 text-sm leading-6 text-slate-300">
              {qaRecordingMessage}
            </p>
          ) : null}

        </section>
      </aside>
    </div>
    </>
  );
}
