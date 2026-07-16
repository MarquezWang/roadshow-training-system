import type { RefObject } from "react";
import { MicrophoneStatusBar } from "@/components/microphone-status-bar";
import type {
  PreviewMode,
  PreviewNotice,
  TrainingFile,
} from "@/lib/use-pitch-pdf-preview";
import type { RecordingStatus } from "@/lib/use-pitch-recording";
import { formatDuration } from "./training-session-format";

type TrainingPitchStageProps = Readonly<{
  projectName: string;
  status: string;
  statusLabel: string;
  statusHint: string;
  recordingStatus: RecordingStatus;
  recordingStatusLabel: string;
  remainingSec: number;
  pageLabel: string;
  message: string;
  fullscreenMessage: string;
  previewFile: TrainingFile | null;
  previewNotice: PreviewNotice | null;
  compatiblePreviewUrl: string | null;
  previewMode: PreviewMode;
  previewContainerRef: RefObject<HTMLDivElement | null>;
  canvasRef: RefObject<HTMLCanvasElement | null>;
  isPdfLoading: boolean;
  pdfError: string;
  currentPageNumber: number;
  isBigScreenMode: boolean;
  isSubmitting: boolean;
  isPitching: boolean;
  canGoPrev: boolean;
  canGoNext: boolean;
  onPreviewModeChange: (mode: PreviewMode) => void;
  onOpenRecordingReenableConfirm: () => void;
  onPrepareRecording: () => void | Promise<void>;
  onEndPitch: () => void | Promise<void>;
  onChangePage: (direction: "PREV" | "NEXT") => void | Promise<void>;
}>;

export function TrainingPitchStage({
  projectName,
  status,
  statusLabel,
  statusHint,
  recordingStatus,
  recordingStatusLabel,
  remainingSec,
  pageLabel,
  message,
  fullscreenMessage,
  previewFile,
  previewNotice,
  compatiblePreviewUrl,
  previewMode,
  previewContainerRef,
  canvasRef,
  isPdfLoading,
  pdfError,
  currentPageNumber,
  isBigScreenMode,
  isSubmitting,
  isPitching,
  canGoPrev,
  canGoNext,
  onPreviewModeChange,
  onOpenRecordingReenableConfirm,
  onPrepareRecording,
  onEndPitch,
  onChangePage,
}: TrainingPitchStageProps) {
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
    ? "grid h-full min-h-0 place-items-center overflow-hidden rounded-md border border-slate-700 bg-slate-950 p-2"
    : "grid h-[calc(100vh-390px)] min-h-96 place-items-center overflow-hidden rounded-md border border-slate-200 bg-slate-200 p-4";
  const mutedTextClassName = isBigScreenMode
    ? "text-slate-300"
    : "text-slate-500";

  return (
    <section className={mainPanelClassName}>
      <div className={headerClassName}>
        <div>
          {isBigScreenMode ? (
            <p className="text-xs font-medium text-slate-400">{projectName}</p>
          ) : null}
          <p
            className={
              isBigScreenMode
                ? "hidden"
                : `text-xs font-medium ${mutedTextClassName}`
            }
          >
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
              isBigScreenMode ? "hidden" : "mt-2 text-sm text-slate-600"
            }
          >
            {statusHint}
          </p>
          <div
            className={
              isBigScreenMode
                ? "hidden"
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
          <p className={timerClassName}>{formatDuration(remainingSec)}</p>
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
                  {previewFile.displaySource === "POWERPOINT_PREVIEW"
                    ? "路演展示材料：PPT/PPTX 已生成展示 PDF"
                    : "路演展示材料：PDF 原文件"}
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
              <div className="hidden">
                <div
                  className={
                    isBigScreenMode
                      ? "inline-flex rounded-md border border-slate-700 bg-slate-900 p-1"
                      : "inline-flex rounded-md border border-slate-200 bg-white p-1"
                  }
                >
                  <button
                    type="button"
                    onClick={() => onPreviewModeChange("standard")}
                    className={
                      previewMode === "standard"
                        ? "rounded bg-slate-950 px-2.5 py-1 text-xs font-medium text-white"
                        : isBigScreenMode
                          ? "rounded px-2.5 py-1 text-xs font-medium text-slate-300 hover:bg-slate-800"
                          : "rounded px-2.5 py-1 text-xs font-medium text-slate-600 hover:bg-slate-100"
                    }
                  >
                    标准预览
                  </button>
                  <button
                    type="button"
                    onClick={() => onPreviewModeChange("compatible")}
                    className={
                      previewMode === "compatible"
                        ? "rounded bg-slate-950 px-2.5 py-1 text-xs font-medium text-white"
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
            <div ref={previewContainerRef} className={previewScrollerClassName}>
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
        ) : previewNotice ? (
          <div>
            <p
              className={`rounded-md border px-4 py-3 text-sm leading-6 ${
                previewNotice.type === "failed"
                  ? isBigScreenMode
                    ? "border-amber-500/40 bg-amber-500/10 text-amber-100"
                    : "border-amber-200 bg-amber-50 text-amber-800"
                  : isBigScreenMode
                    ? "border-slate-700 bg-slate-900 text-slate-300"
                    : "border-dashed border-slate-300 text-slate-600"
              }`}
            >
              {previewNotice.message}
            </p>
            <p className="mt-4 text-6xl font-semibold text-slate-950">
              {currentPageNumber}
            </p>
            <p className="mt-3 text-sm text-slate-600">当前页码</p>
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
              onClick={onOpenRecordingReenableConfirm}
              disabled={isSubmitting}
              className="inline-flex h-10 items-center justify-center rounded-md border border-slate-300 bg-white px-4 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-50 disabled:cursor-not-allowed disabled:bg-slate-100 disabled:text-slate-400"
            >
              重新启用录音
            </button>
          ) : status === "CREATED" ? (
            <button
              type="button"
              onClick={() => void onPrepareRecording()}
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
            onClick={() => void onEndPitch()}
            disabled={!isPitching || isSubmitting}
            className="inline-flex h-10 items-center justify-center rounded-md border border-red-200 bg-red-50 px-4 text-sm font-medium text-red-700 transition-colors hover:bg-red-100 disabled:cursor-not-allowed disabled:border-slate-200 disabled:bg-slate-100 disabled:text-slate-400"
          >
            结束路演
          </button>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <MicrophoneStatusBar />
          <button
            type="button"
            onClick={() => void onChangePage("PREV")}
            disabled={!canGoPrev || isSubmitting}
            className="inline-flex h-10 items-center justify-center rounded-md border border-slate-300 bg-white px-4 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-50 disabled:cursor-not-allowed disabled:bg-slate-100 disabled:text-slate-400"
          >
            上一页
          </button>
          <button
            type="button"
            onClick={() => void onChangePage("NEXT")}
            disabled={!canGoNext || isSubmitting}
            className="inline-flex h-10 items-center justify-center rounded-md border border-slate-300 bg-white px-4 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-50 disabled:cursor-not-allowed disabled:bg-slate-100 disabled:text-slate-400"
          >
            下一页
          </button>
        </div>
      </div>
    </section>
  );
}
