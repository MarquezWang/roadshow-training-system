"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type {
  PDFDocumentLoadingTask,
  PDFDocumentProxy,
  RenderTask,
} from "pdfjs-dist";
import { useTrainingAbortGuard } from "@/lib/use-training-abort-guard";

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
}>;

type QaPhase = "READY" | "ASKING" | "COUNTDOWN" | "ANSWERING" | "SAVING" | "DONE";
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
  // 按优先级排序的 zh-CN 中文男声候选
  const maleVoicePriority = [
    "microsoft xiaoyi online",
    "microsoft xiaoyi",
    "xiaoyi",
    "microsoft yunjian online",
    "microsoft yunxi online",
    "microsoft yunyang online",
    "microsoft kangkang",
    "yunjian",
    "yunxi",
    "yunyang",
    "kangkang",
  ];
  // 筛选中文语音
  const zhVoices = voices.filter((voice) => {
    const key = `${voice.lang} ${voice.name}`.toLowerCase();
    return key.includes("zh-cn") || key.includes("zh") || key.includes("chinese");
  });
  // 在中文语音中按优先级匹配男声
  const maleZhVoice =
    maleVoicePriority
      .flatMap((hint) =>
        zhVoices.filter((voice) =>
          `${voice.name} ${voice.lang}`.toLowerCase().includes(hint),
        ),
      )
      .find(() => true) ?? null;

  return maleZhVoice ?? zhVoices[0] ?? voices[0] ?? null;
}

export function TrainingQaClient({
  sessionId,
  projectName,
  initialStatus,
  initialRemainingSec,
  initialQuestions,
  previewFile,
  files,
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
  const [preAnswerCountdown, setPreAnswerCountdown] = useState(3);
  const [usedAnswerSec, setUsedAnswerSec] = useState(
    Math.max(0, qaLimitSec - Math.min(initialRemainingSec, qaLimitSec)),
  );
  const [message, setMessage] = useState("");
  const [isGenerating, setIsGenerating] = useState(false);
  const [isStarting, setIsStarting] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
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
  });

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
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
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
    await startQuestionRecording();
  }, [startQuestionRecording, usedAnswerSec]);

  const beginPreAnswerCountdown = useCallback(() => {
    clearSpeechTimer();
    clearCountdownTimer();
    setQaPhase("COUNTDOWN");
    setPreAnswerCountdown(3);

    let nextValue = 3;

    countdownIntervalRef.current = window.setInterval(() => {
      nextValue -= 1;

      if (nextValue <= 0) {
        void beginAnswering();
        return;
      }

      setPreAnswerCountdown(nextValue);
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
      hasResumedQaingRef.current ||
      questions.length === 0
    ) {
      return;
    }

    hasResumedQaingRef.current = true;
    beginJudgeQuestion(initialQuestionIndex);
  }, [beginJudgeQuestion, initialQuestionIndex, initialStatus, questions.length]);

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

  async function generateQuestions() {
    setIsGenerating(true);
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
      } | null;

      if (!response.ok) {
        throw new Error(body?.error ?? "答辩问题生成失败。");
      }

      setQuestions(body?.questions ?? []);
      setCurrentQuestionIndex(0);
      setMessage("答辩问题已生成。开始前不会展示完整题目。");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "答辩问题生成失败。");
    } finally {
      setIsGenerating(false);
    }
  }

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
    <div className="grid h-[calc(100vh-24px)] w-full gap-3 overflow-hidden bg-slate-950 text-white lg:grid-cols-[minmax(0,1fr)_300px]">
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
                仍可继续答辩，右侧会显示当前纳入 AI 上下文的材料清单。
              </p>
            </div>
          )}
        </div>

        <div className="mt-3 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-sm text-slate-300">当前页码：{pageLabel}</p>
          <div className="flex flex-wrap gap-2">
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

          {!isQaing ? (
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

              <p className="text-sm leading-6 text-slate-300">
                已生成问题数量：{questions.length}。开始前不展示完整题目正文。
              </p>

              <button
                type="button"
                onClick={() => void generateQuestions()}
                disabled={isGenerating || questions.length > 0}
                className="inline-flex h-10 items-center justify-center rounded-md bg-white px-4 text-sm font-medium text-slate-950 transition-colors hover:bg-slate-200 disabled:cursor-not-allowed disabled:bg-slate-700 disabled:text-slate-400"
              >
                {isGenerating
                  ? "生成中..."
                  : questions.length > 0
                    ? "答辩问题已生成"
                    : "生成答辩问题"}
              </button>
              <button
                type="button"
                onClick={() => void startQa()}
                disabled={isStarting || questions.length === 0}
                className="inline-flex h-10 items-center justify-center rounded-md border border-slate-600 bg-slate-900 px-4 text-sm font-medium text-white transition-colors hover:bg-slate-800 disabled:cursor-not-allowed disabled:border-slate-800 disabled:bg-slate-900/50 disabled:text-slate-500"
              >
                {isStarting ? "开始中..." : "开始答辩"}
              </button>
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

              {qaPhase === "COUNTDOWN" ? (
                <div className="grid h-40 place-items-center rounded-md border border-slate-700 bg-white text-slate-950">
                  <div className="text-center">
                    <p className="text-sm text-slate-500">准备回答</p>
                    <p className="mt-2 text-6xl font-semibold">
                      {preAnswerCountdown}
                    </p>
                  </div>
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

              <button
                type="button"
                onClick={() => void saveAndContinue()}
                disabled={isSaving || qaPhase !== "ANSWERING"}
                className="inline-flex h-10 items-center justify-center rounded-md bg-white px-4 text-sm font-medium text-slate-950 transition-colors hover:bg-slate-200 disabled:cursor-not-allowed disabled:bg-slate-700 disabled:text-slate-400"
              >
                {isSaving ? "保存中..." : mainButtonLabel}
              </button>
            </div>
          ) : null}

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

          <div className="mt-5 rounded-md border border-slate-700 bg-slate-950/60 p-4">
            <h4 className="text-sm font-semibold text-white">
              纳入 AI 上下文的材料
            </h4>
            {files.length > 0 ? (
              <ul className="mt-3 grid gap-2">
                {files.map((file) => (
                  <li
                    key={file.id}
                    className="rounded-md border border-slate-700 bg-slate-900 p-3"
                  >
                    <p className="break-words text-sm font-medium text-slate-100">
                      {file.originalName}
                    </p>
                    <p className="mt-1 text-xs uppercase text-slate-400">
                      {file.fileType}
                    </p>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mt-3 text-sm leading-6 text-slate-300">
                暂无已解析且纳入 AI 上下文的材料。
              </p>
            )}
          </div>
        </section>
      </aside>
    </div>
  );
}
