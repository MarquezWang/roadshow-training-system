"use client";

import type {
  PDFDocumentLoadingTask,
  PDFDocumentProxy,
  RenderTask,
} from "pdfjs-dist";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  buildPitchReplaySegments,
  getReplayPageControlItems,
  getTranscriptExcerptForSegment,
} from "./training-replay/training-replay-flow";
import { TrainingReplayHeader } from "./training-replay/training-replay-header";
import { TrainingReplaySidebar } from "./training-replay/training-replay-sidebar";
import { TrainingReplayStage } from "./training-replay/training-replay-stage";
import type {
  ReplayPreviewFile,
  ReplayRecording,
  ReplaySlideEvent,
} from "./training-replay/training-replay-types";

type TrainingReplayClientProps = Readonly<{
  sessionId: string;
  projectId: string;
  projectName: string;
  recording: ReplayRecording | null;
  pitchDurationSec: number | null;
  previewFile: ReplayPreviewFile | null;
  previewNotice: string | null;
  slideEvents: ReplaySlideEvent[];
}>;

const pdfWorkerSrc = new URL(
  "pdfjs-dist/build/pdf.worker.mjs",
  import.meta.url,
).toString();
const pdfCMapUrl = "/pdfjs/cmaps/";
const pdfStandardFontDataUrl = "/pdfjs/standard_fonts/";
const pdfWasmUrl = "/pdfjs/wasm/";
const pdfIccUrl = "/pdfjs/iccs/";

export function TrainingReplayClient({
  sessionId,
  projectId,
  projectName,
  recording,
  pitchDurationSec,
  previewFile,
  previewNotice,
  slideEvents,
}: TrainingReplayClientProps) {
  const [replayPageIndex, setReplayPageIndex] = useState(0);
  const [isReplayPlaying, setIsReplayPlaying] = useState(false);
  const [pageNotes, setPageNotes] = useState<Record<string, string>>({});
  const [isPageNotesLoaded, setIsPageNotesLoaded] = useState(false);
  const [noteSavedMessage, setNoteSavedMessage] = useState("");
  const [replayPdfDocument, setReplayPdfDocument] =
    useState<PDFDocumentProxy | null>(null);
  const [replayTotalPages, setReplayTotalPages] = useState<number | null>(null);
  const [replayPdfError, setReplayPdfError] = useState("");
  const [isReplayPdfLoading, setIsReplayPdfLoading] = useState(
    Boolean(previewFile),
  );
  const [replayRenderTick, setReplayRenderTick] = useState(0);
  const pitchReplayAudioRef = useRef<HTMLAudioElement | null>(null);
  const replayCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const replayPreviewContainerRef = useRef<HTMLDivElement | null>(null);
  const replayRenderTaskRef = useRef<RenderTask | null>(null);

  const pitchReplaySegments = useMemo(
    () =>
      buildPitchReplaySegments(
        slideEvents,
        recording?.durationSec ?? pitchDurationSec,
      ),
    [pitchDurationSec, recording?.durationSec, slideEvents],
  );
  const safeReplayPageIndex =
    pitchReplaySegments.length > 0
      ? Math.min(replayPageIndex, pitchReplaySegments.length - 1)
      : 0;
  const replayPageControlItems = useMemo(
    () =>
      getReplayPageControlItems(
        pitchReplaySegments.length,
        safeReplayPageIndex,
      ),
    [pitchReplaySegments.length, safeReplayPageIndex],
  );
  const currentReplaySegment = pitchReplaySegments[safeReplayPageIndex] ?? null;
  const replayTotalDurationSec =
    recording?.durationSec ??
    pitchDurationSec ??
    currentReplaySegment?.endSec ??
    0;
  const replayPreviewUrl = previewFile
    ? `/api/files/${previewFile.id}/preview`
    : "";
  const replayPreviewPage = currentReplaySegment?.pageIndex ?? 1;
  const replayTranscriptExcerpt = useMemo(
    () =>
      getTranscriptExcerptForSegment(
        recording?.transcript?.text ?? "",
        recording?.transcript?.segmentsJson,
        currentReplaySegment,
        replayTotalDurationSec,
      ),
    [
      currentReplaySegment,
      recording?.transcript?.segmentsJson,
      recording?.transcript?.text,
      replayTotalDurationSec,
    ],
  );
  const replayNoteKey = currentReplaySegment
    ? String(currentReplaySegment.pageIndex)
    : "1";

  useEffect(() => {
    if (!previewFile || !replayPreviewUrl) {
      const timer = window.setTimeout(() => {
        setReplayPdfDocument(null);
        setReplayTotalPages(null);
        setReplayPdfError("");
        setIsReplayPdfLoading(false);
      }, 0);

      return () => window.clearTimeout(timer);
    }

    let cancelled = false;
    let loadingTask: PDFDocumentLoadingTask | null = null;

    const loadReplayPdf = async () => {
      setReplayPdfError("");
      setIsReplayPdfLoading(true);

      try {
        const pdfjs = await import("pdfjs-dist");
        pdfjs.GlobalWorkerOptions.workerSrc = pdfWorkerSrc;
        loadingTask = pdfjs.getDocument({
          url: replayPreviewUrl,
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
        const pdfDocument = await loadingTask.promise;

        if (cancelled) {
          pdfDocument.destroy();
          return;
        }

        setReplayPdfDocument(pdfDocument);
        setReplayTotalPages(pdfDocument.numPages);
      } catch {
        if (!cancelled) {
          setReplayPdfDocument(null);
          setReplayTotalPages(null);
          setReplayPdfError("材料预览加载失败，请返回训练页检查展示材料。");
        }
      } finally {
        if (!cancelled) {
          setIsReplayPdfLoading(false);
        }
      }
    };

    void loadReplayPdf();

    return () => {
      cancelled = true;
      loadingTask?.destroy();
    };
  }, [previewFile, replayPreviewUrl]);

  useEffect(() => {
    if (!replayPdfDocument || !currentReplaySegment) {
      return undefined;
    }

    const canvas = replayCanvasRef.current;
    const container = replayPreviewContainerRef.current;

    if (!canvas || !container) {
      return undefined;
    }

    let cancelled = false;

    const renderReplayPage = async () => {
      try {
        replayRenderTaskRef.current?.cancel();
        const pageNumber = Math.min(
          Math.max(1, replayPreviewPage),
          replayPdfDocument.numPages,
        );
        const page = await replayPdfDocument.getPage(pageNumber);

        if (cancelled) {
          return;
        }

        const baseViewport = page.getViewport({ scale: 1 });
        const containerWidth = Math.max(container.clientWidth - 24, 320);
        const containerHeight = Math.max(container.clientHeight - 24, 320);
        const scale = Math.min(
          containerWidth / baseViewport.width,
          containerHeight / baseViewport.height,
        );
        const viewport = page.getViewport({ scale });
        const outputScale = window.devicePixelRatio || 1;
        const context = canvas.getContext("2d");

        if (!context) {
          return;
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
        replayRenderTaskRef.current = renderTask;
        await renderTask.promise;
      } catch (error) {
        if (
          !cancelled &&
          error instanceof Error &&
          error.name !== "RenderingCancelledException"
        ) {
          setReplayPdfError("当前页预览渲染失败，请切换页面或重新进入报告。");
        }
      }
    };

    void renderReplayPage();

    return () => {
      cancelled = true;
      replayRenderTaskRef.current?.cancel();
      replayRenderTaskRef.current = null;
    };
  }, [
    currentReplaySegment,
    replayPdfDocument,
    replayPreviewPage,
    replayRenderTick,
  ]);

  useEffect(() => {
    const container = replayPreviewContainerRef.current;

    if (!container) {
      return undefined;
    }

    window.requestAnimationFrame(() => {
      setReplayRenderTick((prev) => prev + 1);
    });

    const resizeObserver = new ResizeObserver(() => {
      setReplayRenderTick((prev) => prev + 1);
    });
    resizeObserver.observe(container);

    return () => resizeObserver.disconnect();
  }, [previewFile]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      try {
        const rawValue = window.localStorage.getItem(
          `training-replay:${sessionId}:pitch-page-notes`,
        );
        const parsed = rawValue ? JSON.parse(rawValue) : {};
        if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
          setPageNotes(parsed as Record<string, string>);
        }
      } catch {
        setPageNotes({});
      } finally {
        setIsPageNotesLoaded(true);
      }
    }, 0);

    return () => window.clearTimeout(timer);
  }, [sessionId]);

  useEffect(() => {
    if (!isPageNotesLoaded) {
      return;
    }

    window.localStorage.setItem(
      `training-replay:${sessionId}:pitch-page-notes`,
      JSON.stringify(pageNotes),
    );
  }, [isPageNotesLoaded, pageNotes, sessionId]);

  useEffect(() => {
    const audio = pitchReplayAudioRef.current;
    if (!audio || !currentReplaySegment) {
      return undefined;
    }

    const handleTimeUpdate = () => {
      if (audio.currentTime >= currentReplaySegment.endSec) {
        audio.pause();
        setIsReplayPlaying(false);
      }
    };
    const handlePause = () => setIsReplayPlaying(false);

    audio.addEventListener("timeupdate", handleTimeUpdate);
    audio.addEventListener("pause", handlePause);

    return () => {
      audio.removeEventListener("timeupdate", handleTimeUpdate);
      audio.removeEventListener("pause", handlePause);
    };
  }, [currentReplaySegment]);

  const playCurrentReplaySegment = useCallback(async () => {
    const audio = pitchReplayAudioRef.current;
    if (!audio || !currentReplaySegment) {
      return;
    }

    audio.currentTime = currentReplaySegment.startSec;

    try {
      await audio.play();
      setIsReplayPlaying(true);
    } catch {
      setIsReplayPlaying(false);
    }
  }, [currentReplaySegment]);

  const pauseCurrentReplaySegment = useCallback(() => {
    const audio = pitchReplayAudioRef.current;
    if (!audio) {
      return;
    }

    audio.pause();
    setIsReplayPlaying(false);
  }, []);

  return (
    <main className="min-h-screen bg-slate-950 px-6 py-6 text-slate-100 lg:px-10">
      <div className="mx-auto flex w-full max-w-[1680px] flex-col gap-5">
        <TrainingReplayHeader
          sessionId={sessionId}
          projectId={projectId}
          projectName={projectName}
        />

        <section className="rounded-lg border border-slate-800 bg-slate-950/70 p-4 shadow-2xl shadow-slate-950/30">
          <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_380px]">
            <TrainingReplayStage
              previewFile={previewFile}
              previewNotice={previewNotice}
              currentReplaySegment={currentReplaySegment}
              replayTotalPages={replayTotalPages}
              pitchReplaySegments={pitchReplaySegments}
              replayPageControlItems={replayPageControlItems}
              safeReplayPageIndex={safeReplayPageIndex}
              isReplayPdfLoading={isReplayPdfLoading}
              replayPdfError={replayPdfError}
              previewContainerRef={replayPreviewContainerRef}
              canvasRef={replayCanvasRef}
              onPreviousPage={() =>
                setReplayPageIndex(Math.max(0, safeReplayPageIndex - 1))
              }
              onNextPage={() =>
                setReplayPageIndex(
                  Math.min(
                    pitchReplaySegments.length - 1,
                    safeReplayPageIndex + 1,
                  ),
                )
              }
              onSelectPage={setReplayPageIndex}
            />

            <TrainingReplaySidebar
              recording={recording}
              currentReplaySegment={currentReplaySegment}
              audioRef={pitchReplayAudioRef}
              isReplayPlaying={isReplayPlaying}
              replayTranscriptExcerpt={replayTranscriptExcerpt}
              noteValue={pageNotes[replayNoteKey] ?? ""}
              noteSavedMessage={noteSavedMessage}
              onPlay={playCurrentReplaySegment}
              onPause={pauseCurrentReplaySegment}
              onNoteChange={(value) => {
                setNoteSavedMessage("");
                setPageNotes((prev) => ({
                  ...prev,
                  [replayNoteKey]: value,
                }));
              }}
              onSaveNote={() => setNoteSavedMessage("已记录")}
            />
          </div>
        </section>
      </div>
    </main>
  );
}
