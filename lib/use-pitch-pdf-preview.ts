"use client";

import type {
  PDFDocumentLoadingTask,
  PDFDocumentProxy,
  RenderTask,
} from "pdfjs-dist";
import { useCallback, useEffect, useRef, useState } from "react";

export type TrainingFile = {
  id: string;
  originalName: string;
  fileType: string;
  previewPdfPath?: string | null;
  previewStatus?: string;
  previewError?: string | null;
  displaySource?: "PDF" | "POWERPOINT_PREVIEW";
};

export type PreviewNotice = {
  type: "converting" | "failed" | "unavailable";
  message: string;
};

export type PreviewMode = "standard" | "compatible";

type UsePitchPdfPreviewOptions = {
  sessionId: string;
  previewFile: TrainingFile | null;
  pageIndex: number;
  elapsedSec: number;
  isPitching: boolean;
  isSubmitting: boolean;
  isBigScreenMode: boolean;
  onDocumentLoaded: (totalPages: number) => void;
  onPageChange: (pageIndex: number) => void;
  onSubmittingChange: (isSubmitting: boolean) => void;
  onPageChangeStart: () => void;
  onError: (message: string) => void;
};

const pdfWorkerSrc = new URL(
  "pdfjs-dist/build/pdf.worker.mjs",
  import.meta.url,
).toString();
const pdfCMapUrl = "/pdfjs/cmaps/";
const pdfStandardFontDataUrl = "/pdfjs/standard_fonts/";
const pdfWasmUrl = "/pdfjs/wasm/";
const pdfIccUrl = "/pdfjs/iccs/";

export function usePitchPdfPreview({
  sessionId,
  previewFile,
  pageIndex,
  elapsedSec,
  isPitching,
  isSubmitting,
  isBigScreenMode,
  onDocumentLoaded,
  onPageChange,
  onSubmittingChange,
  onPageChangeStart,
  onError,
}: UsePitchPdfPreviewOptions) {
  const [pdfDocument, setPdfDocument] = useState<PDFDocumentProxy | null>(null);
  const [totalPages, setTotalPages] = useState<number | null>(null);
  const [pdfError, setPdfError] = useState("");
  const [isPdfLoading, setIsPdfLoading] = useState(Boolean(previewFile));
  const [renderTick, setRenderTick] = useState(0);
  const [previewMode, setPreviewMode] = useState<PreviewMode>("standard");
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const previewContainerRef = useRef<HTMLDivElement | null>(null);
  const renderTaskRef = useRef<RenderTask | null>(null);

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

  const requestRender = useCallback(() => {
    setRenderTick((tick) => tick + 1);
  }, []);

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
        onDocumentLoaded(loadedDocument.numPages);
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
  }, [onDocumentLoaded, previewFile, previewUrl]);

  useEffect(() => {
    if (!pdfDocument || !canvasRef.current) {
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
  }, [previewFile]);

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

      onSubmittingChange(true);
      onPageChangeStart();

      try {
        if (isPitching) {
          await recordSlideEvent(direction, nextPageIndex);
        }

        onPageChange(nextPageIndex);
      } catch (error) {
        onError(error instanceof Error ? error.message : "翻页失败。");
      } finally {
        onSubmittingChange(false);
      }
    },
    [
      isPitching,
      isSubmitting,
      onError,
      onPageChange,
      onPageChangeStart,
      onSubmittingChange,
      pageIndex,
      recordSlideEvent,
      totalPages,
    ],
  );

  return {
    canvasRef,
    previewContainerRef,
    previewUrl,
    compatiblePreviewUrl,
    primaryFileId,
    currentPageNumber,
    totalPages,
    pageLabel,
    canGoPrev,
    canGoNext,
    pdfError,
    isPdfLoading,
    previewMode,
    setPreviewMode,
    changePage,
    requestRender,
  };
}
