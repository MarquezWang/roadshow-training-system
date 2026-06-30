"use client";

import type {
  PDFDocumentLoadingTask,
  PDFDocumentProxy,
  RenderTask,
} from "pdfjs-dist";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

type ReplayPreviewFile = {
  id: string;
  originalName: string;
  fileType: string;
  previewPdfPath?: string | null;
  previewStatus?: string | null;
  previewError?: string | null;
  displaySource?: "PDF" | "POWERPOINT_PREVIEW";
};

type ReplaySlideEvent = {
  id: string;
  fileId: string | null;
  pageIndex: number;
  eventType: string;
  elapsedSec: number;
  createdAt: string;
};

type ReplayTranscript = {
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

type ReplayRecording = {
  id: string;
  phase: string;
  playbackUrl: string;
  mimeType: string;
  sizeBytes: number;
  durationSec: number | null;
  startedAt?: string | null;
  endedAt?: string | null;
  transcript: ReplayTranscript | null;
};

type PitchReplaySegment = {
  pageIndex: number;
  startSec: number;
  endSec: number;
  durationSec: number;
  ranges: Array<{
    startSec: number;
    endSec: number;
  }>;
};

type TranscriptSegment = {
  startMs: number;
  endMs: number;
  text: string;
  speakerId?: string | null;
};

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

function formatReplayTime(totalSec: number) {
  const safeTotal = Number.isFinite(totalSec) ? Math.max(0, Math.floor(totalSec)) : 0;
  const minutes = Math.floor(safeTotal / 60);
  const seconds = safeTotal % 60;
  return `${minutes.toString().padStart(2, "0")}:${seconds
    .toString()
    .padStart(2, "0")}`;
}

function getReplayPageControlItems(total: number, currentIndex: number) {
  if (total <= 9) {
    return Array.from({ length: total }, (_, index) => index);
  }

  const fixedIndexes = new Set<number>([
    0,
    1,
    total - 2,
    total - 1,
    currentIndex - 2,
    currentIndex - 1,
    currentIndex,
    currentIndex + 1,
    currentIndex + 2,
  ]);

  const indexes = Array.from(fixedIndexes)
    .filter((index) => index >= 0 && index < total)
    .sort((left, right) => left - right);
  const items: Array<number | "ellipsis"> = [];

  indexes.forEach((index) => {
    const previous = items[items.length - 1];
    if (typeof previous === "number" && index - previous > 1) {
      items.push("ellipsis");
    }
    items.push(index);
  });

  return items;
}

function buildPitchReplaySegments(
  events: ReplaySlideEvent[],
  fallbackDurationSec: number | null,
): PitchReplaySegment[] {
  const orderedEvents = events
    .filter(
      (event) =>
        Number.isFinite(event.elapsedSec) &&
        Number.isFinite(event.pageIndex) &&
        event.pageIndex > 0,
    )
    .sort((a, b) => {
      if (a.elapsedSec !== b.elapsedSec) {
        return a.elapsedSec - b.elapsedSec;
      }
      return a.createdAt.localeCompare(b.createdAt);
    });
  const maxEventSec = orderedEvents.reduce(
    (max, event) => Math.max(max, event.elapsedSec),
    0,
  );
  const totalDurationSec = Math.max(fallbackDurationSec ?? 0, maxEventSec);

  if (orderedEvents.length === 0) {
    return totalDurationSec > 0
      ? [
          {
            pageIndex: 1,
            startSec: 0,
            endSec: totalDurationSec,
            durationSec: totalDurationSec,
            ranges: [{ startSec: 0, endSec: totalDurationSec }],
          },
        ]
      : [];
  }

  const pageRanges = new Map<number, Array<{ startSec: number; endSec: number }>>();

  orderedEvents.forEach((event, index) => {
    if (event.eventType === "END") {
      return;
    }

    const startSec = Math.max(0, event.elapsedSec);
    const nextEvent = orderedEvents
      .slice(index + 1)
      .find((item) => item.elapsedSec >= startSec);
    const endSec = nextEvent ? nextEvent.elapsedSec : totalDurationSec;

    if (endSec <= startSec) {
      return;
    }

    const ranges = pageRanges.get(event.pageIndex) ?? [];
    ranges.push({ startSec, endSec });
    pageRanges.set(event.pageIndex, ranges);
  });

  return Array.from(pageRanges.entries())
    .map(([pageIndex, ranges]) => {
      const durationSec = ranges.reduce(
        (total, range) => total + Math.max(0, range.endSec - range.startSec),
        0,
      );
      return {
        pageIndex,
        startSec: ranges[0]?.startSec ?? 0,
        endSec: ranges[0]?.endSec ?? 0,
        durationSec,
        ranges,
      };
    })
    .filter((segment) => segment.durationSec > 0)
    .sort((a, b) => a.pageIndex - b.pageIndex);
}

function parseTranscriptSegments(
  value: string | null | undefined,
): TranscriptSegment[] {
  if (!value) {
    return [];
  }

  try {
    const parsed = JSON.parse(value) as unknown;
    if (!Array.isArray(parsed)) {
      return [];
    }

    const segments: TranscriptSegment[] = [];

    for (const item of parsed) {
      if (!item || typeof item !== "object" || Array.isArray(item)) {
        continue;
      }

      const record = item as Record<string, unknown>;
      const startMs = Number(record.startMs);
      const endMs = Number(record.endMs);
      const segmentText =
        typeof record.text === "string" ? record.text.trim() : "";

      if (
        !Number.isFinite(startMs) ||
        !Number.isFinite(endMs) ||
        endMs <= startMs ||
        !segmentText
      ) {
        continue;
      }

      segments.push({
        startMs,
        endMs,
        text: segmentText,
        speakerId:
          typeof record.speakerId === "string" ? record.speakerId : null,
      });
    }

    return segments.sort((left, right) => left.startMs - right.startMs);
  } catch {
    return [];
  }
}

function trimTranscriptSegmentToWindow(
  segment: TranscriptSegment,
  windowStartMs: number,
  windowEndMs: number,
) {
  const segmentDurationMs = segment.endMs - segment.startMs;

  if (segmentDurationMs <= 0) {
    return "";
  }

  const characters = Array.from(segment.text);
  let startIndex = 0;
  let endIndex = characters.length;
  const crossesStart = segment.startMs < windowStartMs;
  const crossesEnd = segment.endMs > windowEndMs;

  if (crossesStart) {
    const startRatio = Math.min(
      1,
      Math.max(0, (windowStartMs - segment.startMs) / segmentDurationMs),
    );
    startIndex = Math.min(
      characters.length,
      Math.floor(characters.length * startRatio),
    );
  }

  if (crossesEnd) {
    const endRatio = Math.min(
      1,
      Math.max(0, (windowEndMs - segment.startMs) / segmentDurationMs),
    );
    endIndex = Math.max(startIndex, Math.ceil(characters.length * endRatio));
  }

  let text = characters.slice(startIndex, endIndex).join("").trim();

  if (crossesStart) {
    text = text.replace(/^[，。！？；、,.!?;\s]+/, "");
    const firstSentenceEnd = text.search(/[。！？?]/);

    if (firstSentenceEnd >= 0 && firstSentenceEnd <= 18) {
      text = text.slice(firstSentenceEnd + 1).trim();
    }
  }

  if (crossesEnd) {
    text = text.replace(/[，。！？；、,.!?;\s]+$/, "");
  }

  return text;
}

function getPreciseTranscriptExcerpt(
  segments: TranscriptSegment[],
  segment: PitchReplaySegment | null,
) {
  if (!segment || segments.length === 0) {
    return "";
  }

  const startMs = segment.startSec * 1000;
  const endMs = segment.endSec * 1000;

  return segments
    .filter((item) => item.endMs > startMs && item.startMs < endMs)
    .map((item) => trimTranscriptSegmentToWindow(item, startMs, endMs))
    .filter(Boolean)
    .join("")
    .replace(/\s+/g, " ")
    .trim();
}

function getTranscriptExcerptForSegment(
  text: string,
  segmentsJson: string | null | undefined,
  segment: PitchReplaySegment | null,
  totalDurationSec: number,
) {
  const segments = parseTranscriptSegments(segmentsJson);
  const preciseText = getPreciseTranscriptExcerpt(segments, segment);

  if (preciseText) {
    return {
      text: preciseText,
      matchType: "precise" as const,
    };
  }

  const trimmedText = text.trim();
  if (!trimmedText || !segment || totalDurationSec <= 0) {
    return {
      text: "",
      matchType: "none" as const,
    };
  }

  const startRatio = Math.min(1, Math.max(0, segment.startSec / totalDurationSec));
  const endRatio = Math.min(1, Math.max(startRatio, segment.endSec / totalDurationSec));
  const startIndex = Math.floor(trimmedText.length * startRatio);
  const endIndex = Math.max(
    startIndex + 1,
    Math.ceil(trimmedText.length * endRatio),
  );

  return {
    text: trimmedText.slice(startIndex, endIndex).trim(),
    matchType: "estimated" as const,
  };
}

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
  const [isReplayPdfLoading, setIsReplayPdfLoading] = useState(Boolean(previewFile));
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
    () => getReplayPageControlItems(pitchReplaySegments.length, safeReplayPageIndex),
    [pitchReplaySegments.length, safeReplayPageIndex],
  );
  const currentReplaySegment = pitchReplaySegments[safeReplayPageIndex] ?? null;
  const replayTotalDurationSec =
    recording?.durationSec ??
    pitchDurationSec ??
    (currentReplaySegment?.endSec ?? 0);
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
              ? ([
                  outputScale,
                  0,
                  0,
                  outputScale,
                  0,
                  0,
                ] as [number, number, number, number, number, number])
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
        <header className="flex flex-col gap-3 border-b border-slate-800 pb-4 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="text-xs text-slate-500">路演回放</p>
            <h1 className="mt-1 text-xl font-semibold text-slate-50">
              {projectName}
            </h1>
            <p className="mt-1 text-xs text-slate-500">
              按训练时翻页记录同步查看材料、音频、转写和个人笔记。
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Link
              href={`/training/${sessionId}/report`}
              className="inline-flex h-9 items-center justify-center rounded-md border border-slate-700 bg-slate-900 px-3 text-xs font-medium text-slate-200 transition-colors hover:bg-slate-800"
            >
              查看报告
            </Link>
            <Link
              href={`/projects/${projectId}`}
              className="inline-flex h-9 items-center justify-center rounded-md border border-slate-700 bg-slate-900 px-3 text-xs font-medium text-slate-200 transition-colors hover:bg-slate-800"
            >
              返回项目详情
            </Link>
          </div>
        </header>

        <section className="rounded-lg border border-slate-800 bg-slate-950/70 p-4 shadow-2xl shadow-slate-950/30">
          <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_380px]">
            <div className="rounded-lg border border-slate-800 bg-slate-950 p-3">
              <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                <div>
                  <p className="text-xs font-medium text-slate-200">
                    {previewFile?.originalName ?? "暂无可预览材料"}
                  </p>
                  <p className="mt-1 text-xs text-slate-500">
                    {currentReplaySegment
                      ? `当前第 ${currentReplaySegment.pageIndex} 页${
                          replayTotalPages ? ` / ${replayTotalPages}` : ""
                        }`
                      : previewNotice ?? "未记录可回放的页面片段。"}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() =>
                      setReplayPageIndex(() =>
                        Math.max(0, safeReplayPageIndex - 1),
                      )
                    }
                    disabled={safeReplayPageIndex <= 0}
                    className="rounded-md border border-slate-700 px-3 py-1.5 text-xs font-medium text-slate-200 transition-colors hover:bg-slate-900 disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    上一页
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      setReplayPageIndex(() =>
                        Math.min(
                          pitchReplaySegments.length - 1,
                          safeReplayPageIndex + 1,
                        ),
                      )
                    }
                    disabled={
                      safeReplayPageIndex >= pitchReplaySegments.length - 1
                    }
                    className="rounded-md border border-slate-700 px-3 py-1.5 text-xs font-medium text-slate-200 transition-colors hover:bg-slate-900 disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    下一页
                  </button>
                </div>
              </div>

              <div
                ref={replayPreviewContainerRef}
                className="relative flex h-[72vh] min-h-[600px] items-center justify-center overflow-hidden rounded-md border border-slate-800 bg-slate-950 p-3"
              >
                {previewFile && currentReplaySegment ? (
                  <>
                    <canvas
                      ref={replayCanvasRef}
                      className="max-h-full max-w-full rounded-sm bg-white shadow-2xl shadow-slate-950/40"
                    />
                    {isReplayPdfLoading ? (
                      <div className="absolute rounded-md bg-slate-950/80 px-3 py-2 text-xs text-slate-300">
                        正在加载材料预览...
                      </div>
                    ) : null}
                    {replayPdfError ? (
                      <div className="absolute max-w-sm rounded-md border border-red-500/30 bg-red-950/80 px-4 py-3 text-center text-sm text-red-100">
                        {replayPdfError}
                      </div>
                    ) : null}
                  </>
                ) : (
                  <div className="px-6 text-center text-sm text-slate-400">
                    <p>{previewNotice ?? "当前没有可预览的 PDF 材料。"}</p>
                    <p className="mt-2 text-xs text-slate-500">
                      仍可查看右侧路演录音、转写和笔记。
                    </p>
                  </div>
                )}
              </div>

              {pitchReplaySegments.length > 0 ? (
                <div className="mt-3 flex flex-wrap items-center gap-2">
                  <span className="mr-1 text-xs text-slate-500">页面片段</span>
                  {replayPageControlItems.map((item, itemIndex) => {
                    if (item === "ellipsis") {
                      return (
                        <span
                          key={`ellipsis-${itemIndex}`}
                          className="px-1 text-xs text-slate-500"
                        >
                          ...
                        </span>
                      );
                    }

                    const segment = pitchReplaySegments[item];

                    return (
                      <button
                        key={`${segment.pageIndex}-${item}`}
                        type="button"
                        onClick={() => setReplayPageIndex(item)}
                        className={`rounded-full border px-3 py-1 text-xs font-medium transition-colors ${
                          item === safeReplayPageIndex
                            ? "border-teal-400 bg-teal-400/15 text-teal-100"
                            : "border-slate-700 bg-slate-900 text-slate-300 hover:bg-slate-800"
                        }`}
                      >
                        第 {segment.pageIndex} 页 ·{" "}
                        {formatReplayTime(segment.durationSec)}
                      </button>
                    );
                  })}
                </div>
              ) : null}
            </div>

            <aside className="grid content-start gap-4">
              <div className="rounded-lg border border-slate-800 bg-slate-900/80 p-4">
                <h3 className="text-sm font-semibold text-slate-100">
                  本页音频
                </h3>
                {recording && currentReplaySegment ? (
                  <div className="mt-3 grid gap-3">
                    <audio
                      ref={pitchReplayAudioRef}
                      controls
                      preload="metadata"
                      src={recording.playbackUrl}
                      className="w-full"
                    >
                      <track kind="captions" />
                    </audio>
                    <div className="flex flex-wrap gap-2">
                      <button
                        type="button"
                        onClick={() => void playCurrentReplaySegment()}
                        className="rounded-md bg-teal-400/90 px-3 py-1.5 text-xs font-medium text-slate-950 transition-colors hover:bg-teal-300"
                      >
                        {isReplayPlaying ? "重新播放本页" : "播放本页片段"}
                      </button>
                      <button
                        type="button"
                        onClick={pauseCurrentReplaySegment}
                        className="rounded-md border border-slate-700 bg-slate-950 px-3 py-1.5 text-xs font-medium text-slate-300 transition-colors hover:bg-slate-800"
                      >
                        暂停
                      </button>
                    </div>
                    <p className="text-xs leading-5 text-slate-500">
                      片段区间：{formatReplayTime(currentReplaySegment.startSec)}
                      {" - "}
                      {formatReplayTime(currentReplaySegment.endSec)}
                      <br />
                      本页累计用时：
                      {formatReplayTime(currentReplaySegment.durationSec)}
                    </p>
                  </div>
                ) : (
                  <p className="mt-3 text-sm leading-6 text-slate-500">
                    当前没有可用的路演录音或页面片段。
                  </p>
                )}
              </div>

              <div className="rounded-lg border border-slate-800 bg-slate-900/80 p-4">
                <h3 className="text-sm font-semibold text-slate-100">
                  本页转写
                </h3>
                <p className="mt-1 text-xs text-slate-500">
                  {currentReplaySegment
                    ? `本页用时 ${formatReplayTime(
                        currentReplaySegment.durationSec,
                      )}`
                    : "暂无页面用时"}
                  {replayTranscriptExcerpt.matchType === "precise"
                    ? " · 已按句子时间戳精确匹配"
                    : replayTranscriptExcerpt.matchType === "estimated"
                      ? " · 按页面用时粗略匹配"
                      : ""}
                </p>
                <div className="mt-3 max-h-72 overflow-y-auto rounded-md border border-slate-800 bg-slate-950/70 p-3 text-sm leading-6 text-slate-300">
                  {replayTranscriptExcerpt.text ||
                    "暂无可匹配的本页转写片段。新训练若使用腾讯云极速版时间戳，将按本页音频时间精确匹配。"}
                </div>
              </div>

              <div className="rounded-lg border border-slate-800 bg-slate-900/80 p-4">
                <h3 className="text-sm font-semibold text-slate-100">本页笔记</h3>
                <p className="mt-1 text-xs text-slate-500">
                  记录这一页讲得不好的地方、需要补充的证据或下一轮改法。
                </p>
                <textarea
                  value={pageNotes[replayNoteKey] ?? ""}
                  onChange={(event) => {
                    setNoteSavedMessage("");
                    setPageNotes((prev) => ({
                      ...prev,
                      [replayNoteKey]: event.target.value,
                    }));
                  }}
                  placeholder="例如：这一页背景痛点讲得太泛，需要补一个真实客户场景。"
                  className="mt-3 min-h-36 w-full resize-y rounded-md border border-slate-700 bg-slate-950/70 px-3 py-2 text-sm leading-6 text-slate-200 outline-none transition-colors placeholder:text-slate-600 focus:border-teal-400"
                />
                <div className="mt-2 flex items-center justify-between gap-3">
                  <p className="text-xs text-slate-500">
                    笔记会保存在当前浏览器本地。
                  </p>
                  <div className="flex items-center gap-2">
                    {noteSavedMessage ? (
                      <span className="text-xs text-emerald-400">
                        {noteSavedMessage}
                      </span>
                    ) : null}
                    <button
                      type="button"
                      onClick={() => setNoteSavedMessage("已记录")}
                      className="rounded-md bg-teal-400/90 px-3 py-1.5 text-xs font-medium text-slate-950 transition-colors hover:bg-teal-300"
                    >
                      记录
                    </button>
                  </div>
                </div>
              </div>
            </aside>
          </div>
        </section>
      </div>
    </main>
  );
}
