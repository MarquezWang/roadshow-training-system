"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type {
  PDFDocumentLoadingTask,
  PDFDocumentProxy,
  RenderTask,
} from "pdfjs-dist";

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

type QaPhase = "ready" | "judgeSpeaking" | "preAnswer" | "answering";
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
  const maleVoiceHints = ["Yunxi", "Kangkang", "Male", "男"];
  const zhCnVoices = voices.filter((voice) =>
    `${voice.lang} ${voice.name}`.toLowerCase().includes("zh-cn"),
  );
  const maleVoice =
    voices.find((voice) =>
      maleVoiceHints.some((hint) =>
        `${voice.name} ${voice.lang}`.toLowerCase().includes(hint.toLowerCase()),
      ),
    ) ?? null;

  return maleVoice ?? zhCnVoices[0] ?? null;
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
    initialStatus === "QAING" ? "answering" : "ready",
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
    if (qaPhase !== "answering" || answerPhaseStartedMsRef.current === null) {
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
    currentAnswerStartedAtRef.current = new Date();
    answerPhaseStartedMsRef.current = Date.now();
    answerElapsedBeforePhaseRef.current = usedAnswerSec;
    setQaPhase("answering");
    await startQuestionRecording();
  }, [startQuestionRecording, usedAnswerSec]);

  const beginPreAnswerCountdown = useCallback(() => {
    clearSpeechTimer();
    clearCountdownTimer();
    setQaPhase("preAnswer");
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

  const beginJudgeQuestion = useCallback(
    (questionIndex: number) => {
      const question = questions[questionIndex];

      if (!question) {
        return;
      }

      clearSpeechTimer();
      clearCountdownTimer();
      window.speechSynthesis?.cancel();
      setCurrentQuestionIndex(questionIndex);
      setQaPhase("judgeSpeaking");
      setMessage("");
      setQaRecordingStatus("idle");
      setQaRecordingMessage("");

      if (
        typeof window === "undefined" ||
        !("speechSynthesis" in window) ||
        typeof SpeechSynthesisUtterance === "undefined"
      ) {
        setMessage("当前浏览器不支持语音提问，已切换为文字提问。");
        setRevealedQuestionIds((current) => new Set(current).add(question.id));
        beginPreAnswerCountdown();
        return;
      }

      const utterance = new SpeechSynthesisUtterance(question.questionText);
      const selectedVoice = chooseJudgeVoice(window.speechSynthesis.getVoices());
      let hasMovedOn = false;
      const moveOn = () => {
        if (hasMovedOn) {
          return;
        }

        hasMovedOn = true;
        beginPreAnswerCountdown();
      };

      if (selectedVoice) {
        utterance.voice = selectedVoice;
      }

      // 本地浏览器语音质量受操作系统 voices 限制；这里只做优先级选择，不接外部 TTS。
      utterance.lang = "zh-CN";
      utterance.rate = 1.15;
      utterance.pitch = 0.92;
      utterance.onend = moveOn;
      utterance.onerror = () => {
        setMessage("语音提问不可用，已切换为文字提问。");
        setRevealedQuestionIds((current) => new Set(current).add(question.id));
        moveOn();
      };
      speechTimeoutRef.current = window.setTimeout(
        moveOn,
        estimateQuestionSpeechMs(question.questionText),
      );
      window.speechSynthesis.speak(utterance);
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

        router.push(`/training/${sessionId}/report`);
      } catch (error) {
        hasAutoEndedRef.current = false;
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
    if (!isQaing || qaPhase !== "answering") {
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
    if (!currentQuestion || qaPhase !== "answering") {
      return;
    }

    setIsSaving(true);
    setMessage("");

    try {
      const currentUsedAnswerSec = getCurrentUsedAnswerSec();
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
    qaPhase === "judgeSpeaking"
      ? "评委正在提问"
      : qaPhase === "preAnswer"
        ? "准备回答"
        : qaPhase === "answering"
          ? "回答中"
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
    <div className="grid min-h-[calc(100vh-140px)] gap-4 xl:grid-cols-[minmax(0,1fr)_340px]">
      <section className="flex min-h-[calc(100vh-150px)] flex-col rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
        <div className="mb-3 flex flex-col gap-3 border-b border-slate-200 pb-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <p className="text-sm font-medium text-slate-500">材料参考区</p>
            <h2 className="text-lg font-semibold text-slate-950">
              {projectName}
            </h2>
            {previewFile ? (
              <p className="mt-1 text-xs text-slate-500">
                {previewFile.originalName}，当前 {pageLabel}
              </p>
            ) : null}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {previewFile ? (
              <div className="inline-flex rounded-md border border-slate-200 bg-white p-1">
                <button
                  type="button"
                  onClick={() => setPreviewMode("standard")}
                  className={
                    previewMode === "standard"
                      ? "rounded bg-slate-950 px-2.5 py-1 text-xs font-medium text-white"
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
                      ? "rounded bg-slate-950 px-2.5 py-1 text-xs font-medium text-white"
                      : "rounded px-2.5 py-1 text-xs font-medium text-slate-600 hover:bg-slate-100"
                  }
                >
                  兼容预览
                </button>
              </div>
            ) : null}
            <span className="inline-flex rounded-md border border-slate-200 bg-slate-50 px-2.5 py-1 text-xs font-medium text-slate-600">
              翻页不写入路演事件
            </span>
          </div>
        </div>

        {previewFile ? (
          <div className="grid min-h-0 flex-1 grid-rows-[minmax(0,1fr)_auto] gap-3">
            <div
              ref={previewContainerRef}
              className={
                previewMode === "standard"
                  ? "grid min-h-[calc(100vh-300px)] place-items-center overflow-hidden rounded-lg border border-slate-200 bg-slate-100 p-4"
                  : "grid min-h-[calc(100vh-300px)] overflow-hidden rounded-lg border border-slate-200 bg-slate-100"
              }
            >
              {previewMode === "compatible" && compatiblePreviewUrl ? (
                <iframe
                  title={`${previewFile.originalName} 兼容预览`}
                  src={compatiblePreviewUrl}
                  className="h-full min-h-[calc(100vh-300px)] w-full border-0 bg-white"
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

            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <p className="text-sm text-slate-600">当前页码：{pageLabel}</p>
              <div className="flex flex-wrap gap-2">
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
          </div>
        ) : (
          <div className="grid min-h-[620px] flex-1 place-items-center rounded-md border border-dashed border-slate-300 bg-slate-50 p-6 text-center">
            <div>
              <p className="text-base font-semibold text-slate-950">
                当前没有可预览的 PDF 材料
              </p>
              <p className="mt-2 text-sm leading-6 text-slate-600">
                仍可继续答辩，右侧会显示当前纳入 AI 上下文的材料清单。
              </p>
            </div>
          </div>
        )}
      </section>

      <aside className="grid content-start gap-4">
        <section className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
          <p className="text-sm font-medium text-slate-500">语音评委答辩舱</p>
          <h3 className="mt-2 text-xl font-semibold text-slate-950">
            {phaseLabel}
          </h3>

          <dl className="mt-5 grid grid-cols-2 gap-3 text-sm">
            <div className="rounded-md border border-slate-200 bg-slate-50 p-3">
              <dt className="text-slate-500">当前题号</dt>
              <dd className="mt-1 font-semibold text-slate-950">
                {questions.length > 0 && currentQuestion
                  ? `${currentQuestion.orderIndex} / ${questions.length}`
                  : `0 / ${questions.length}`}
              </dd>
            </div>
            <div className="rounded-md border border-slate-200 bg-slate-50 p-3">
              <dt className="text-slate-500">剩余答题时间</dt>
              <dd
                className={
                  remainingSec <= 30
                    ? "mt-1 text-lg font-semibold text-red-700"
                    : "mt-1 text-lg font-semibold text-slate-950"
                }
              >
                {formatDuration(remainingSec)}
              </dd>
            </div>
            <div className="rounded-md border border-slate-200 bg-slate-50 p-3">
              <dt className="text-slate-500">答辩状态</dt>
              <dd className="mt-1 font-semibold text-slate-950">{status}</dd>
            </div>
            <div className="rounded-md border border-slate-200 bg-slate-50 p-3">
              <dt className="text-slate-500">录音状态</dt>
              <dd className="mt-1 font-semibold text-slate-950">
                {recordingLabel[qaRecordingStatus]}
              </dd>
            </div>
          </dl>

          {!isQaing ? (
            <div className="mt-5 grid gap-4">
              <div className="rounded-md border border-slate-200 bg-slate-50 p-4">
                <h4 className="text-sm font-semibold text-slate-950">
                  答辩规则
                </h4>
                <ul className="mt-3 grid gap-2 text-sm leading-6 text-slate-700">
                  <li>总答题时间 3 分钟，评委提问期间不扣时。</li>
                  <li>系统一次只进入一道题。</li>
                  <li>问题默认语音播报，可按需查看文字。</li>
                  <li>回答完毕后点击进入下一题，最后一题点击完成答辩。</li>
                </ul>
              </div>

              <p className="text-sm leading-6 text-slate-600">
                已生成问题数量：{questions.length}。开始前不展示完整问题正文。
              </p>

              <button
                type="button"
                onClick={() => void generateQuestions()}
                disabled={isGenerating || questions.length > 0}
                className="inline-flex h-10 items-center justify-center rounded-md bg-slate-950 px-4 text-sm font-medium text-white transition-colors hover:bg-slate-800 disabled:cursor-not-allowed disabled:bg-slate-300"
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
                className="inline-flex h-10 items-center justify-center rounded-md border border-slate-300 bg-white px-4 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-50 disabled:cursor-not-allowed disabled:bg-slate-100 disabled:text-slate-400"
              >
                {isStarting ? "开始中..." : "开始答辩"}
              </button>
            </div>
          ) : currentQuestion ? (
            <div className="mt-5 grid gap-4">
              {qaPhase === "judgeSpeaking" ? (
                <div className="rounded-md border border-slate-200 bg-slate-50 p-4 text-center">
                  <p className="text-base font-semibold text-slate-950">
                    评委正在提问，请认真听题
                  </p>
                  <p className="mt-2 text-sm text-slate-600">
                    第 {currentQuestion.orderIndex} 题语音播报中，提问结束后将进入
                    3、2、1 准备倒计时。
                  </p>
                </div>
              ) : null}

              {qaPhase === "preAnswer" ? (
                <div className="grid h-40 place-items-center rounded-md border border-slate-200 bg-slate-950 text-white">
                  <div className="text-center">
                    <p className="text-sm text-slate-300">准备回答</p>
                    <p className="mt-2 text-6xl font-semibold">
                      {preAnswerCountdown}
                    </p>
                  </div>
                </div>
              ) : null}

              {qaPhase === "answering" ? (
                <div className="rounded-md border border-slate-200 bg-slate-50 p-4">
                  <p className="text-base font-semibold text-slate-950">
                    请开始口头回答
                  </p>
                  <p className="mt-2 text-sm leading-6 text-slate-600">
                    回答期间答题倒计时持续减少。答完后点击下方按钮保存本题用时和录音。
                  </p>
                  {remainingSec < 30 && !isLastQuestion ? (
                    <p className="mt-3 rounded-md border border-amber-200 bg-amber-50 p-3 text-sm leading-6 text-amber-800">
                      剩余答题时间较少，建议保存本题并完成答辩。
                    </p>
                  ) : null}
                </div>
              ) : null}

              <div className="rounded-md border border-slate-200 bg-white p-4">
                <div className="flex items-center justify-between gap-3">
                  <p className="text-xs font-medium uppercase text-slate-500">
                    Q{currentQuestion.orderIndex} /{" "}
                    {currentQuestion.questionType ?? "QUESTION"}
                  </p>
                  <button
                    type="button"
                    onClick={revealQuestionText}
                    className="inline-flex h-8 items-center justify-center rounded-md border border-slate-300 bg-white px-3 text-xs font-medium text-slate-700 transition-colors hover:bg-slate-50"
                  >
                    查看问题文字
                  </button>
                </div>

                {revealedQuestionIds.has(currentQuestion.id) ? (
                  <div className="mt-3 rounded-md border border-slate-200 bg-slate-50 p-3">
                    <p className="text-sm font-semibold leading-6 text-slate-950">
                      {currentQuestion.questionText}
                    </p>
                    {currentQuestion.basis ? (
                      <p className="mt-2 text-xs leading-5 text-slate-500">
                        依据：{currentQuestion.basis}
                      </p>
                    ) : null}
                  </div>
                ) : (
                  <p className="mt-3 text-sm leading-6 text-slate-600">
                    问题文字默认隐藏。若没听清，可点击“查看问题文字”。
                  </p>
                )}
              </div>

              <button
                type="button"
                onClick={() => void saveAndContinue()}
                disabled={isSaving || qaPhase !== "answering"}
                className="inline-flex h-10 items-center justify-center rounded-md bg-slate-950 px-4 text-sm font-medium text-white transition-colors hover:bg-slate-800 disabled:cursor-not-allowed disabled:bg-slate-300"
              >
                {isSaving ? "保存中..." : mainButtonLabel}
              </button>
            </div>
          ) : null}

          {message ? (
            <p className="mt-4 rounded-md border border-slate-200 bg-slate-50 p-3 text-sm leading-6 text-slate-700">
              {message}
            </p>
          ) : null}
          {qaRecordingMessage ? (
            <p className="mt-3 rounded-md border border-slate-200 bg-slate-50 p-3 text-sm leading-6 text-slate-700">
              {qaRecordingMessage}
            </p>
          ) : null}
        </section>

        <section className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
          <h3 className="text-base font-semibold text-slate-950">
            纳入 AI 上下文的材料
          </h3>
          {files.length > 0 ? (
            <ul className="mt-3 grid gap-2">
              {files.map((file) => (
                <li
                  key={file.id}
                  className="rounded-md border border-slate-200 bg-slate-50 p-3"
                >
                  <p className="break-words text-sm font-medium text-slate-900">
                    {file.originalName}
                  </p>
                  <p className="mt-1 text-xs uppercase text-slate-500">
                    {file.fileType}
                  </p>
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-3 text-sm leading-6 text-slate-600">
              暂无已解析且纳入 AI 上下文的材料。
            </p>
          )}
        </section>
      </aside>
    </div>
  );
}
