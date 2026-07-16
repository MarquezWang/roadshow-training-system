import type { RefObject } from "react";
import { MicrophoneStatusBar } from "@/components/microphone-status-bar";
import type { DisplayMaterialNotice } from "@/lib/display-material";
import type {
  QaPreviewFile,
  QaPreviewMode,
} from "@/lib/use-qa-material-preview";
import { formatQaDuration } from "./training-qa-format";

type TrainingQaStageProps = Readonly<{
  projectName: string;
  phaseLabel: string;
  remainingSec: number;
  questionProgressLabel: string;
  previewFile: QaPreviewFile | null;
  previewNotice: DisplayMaterialNotice | null;
  pageLabel: string;
  previewMode: QaPreviewMode;
  compatiblePreviewUrl: string | null;
  previewContainerRef: RefObject<HTMLDivElement | null>;
  canvasRef: RefObject<HTMLCanvasElement | null>;
  isPdfLoading: boolean;
  pdfError: string;
  canGoPrev: boolean;
  canGoNext: boolean;
  isGenerating: boolean;
  canStartQa: boolean;
  canSaveAnswer: boolean;
  hasCurrentQuestion: boolean;
  isStarting: boolean;
  isSaving: boolean;
  mainButtonLabel: string;
  onPreviewModeChange: (mode: QaPreviewMode) => void;
  onStartQa: () => void | Promise<void>;
  onSaveAnswer: () => void | Promise<void>;
  onRevealQuestionText: () => void;
  onChangeMaterialPage: (direction: "PREV" | "NEXT") => void;
}>;

export function TrainingQaStage({
  projectName,
  phaseLabel,
  remainingSec,
  questionProgressLabel,
  previewFile,
  previewNotice,
  pageLabel,
  previewMode,
  compatiblePreviewUrl,
  previewContainerRef,
  canvasRef,
  isPdfLoading,
  pdfError,
  canGoPrev,
  canGoNext,
  isGenerating,
  canStartQa,
  canSaveAnswer,
  hasCurrentQuestion,
  isStarting,
  isSaving,
  mainButtonLabel,
  onPreviewModeChange,
  onStartQa,
  onSaveAnswer,
  onRevealQuestionText,
  onChangeMaterialPage,
}: TrainingQaStageProps) {
  return (
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
            {formatQaDuration(remainingSec)}
          </p>
          <p className="mt-1 text-sm text-slate-300">{questionProgressLabel}</p>
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
                    onClick={() => onPreviewModeChange("standard")}
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
                    onClick={() => onPreviewModeChange("compatible")}
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
            <p className="mt-3 text-sm text-slate-400">仍可继续答辩。</p>
          </div>
        ) : (
          <div>
            <p className="text-sm font-medium text-slate-300">
              当前没有可预览的 PDF 材料
            </p>
            <p className="mt-3 text-sm text-slate-400">仍可继续答辩。</p>
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
          ) : canStartQa ? (
            <button
              type="button"
              onClick={() => void onStartQa()}
              disabled={isStarting}
              className="inline-flex h-10 items-center justify-center rounded-md bg-white px-4 text-sm font-medium text-slate-950 transition-colors hover:bg-slate-200 disabled:cursor-not-allowed disabled:bg-slate-700 disabled:text-slate-400"
            >
              开始答辩
            </button>
          ) : canSaveAnswer ? (
            <button
              type="button"
              onClick={() => void onSaveAnswer()}
              disabled={isSaving}
              className="inline-flex h-10 items-center justify-center rounded-md bg-white px-4 text-sm font-medium text-slate-950 transition-colors hover:bg-slate-200 disabled:cursor-not-allowed disabled:bg-slate-700 disabled:text-slate-400"
            >
              {isSaving ? "保存中..." : mainButtonLabel}
            </button>
          ) : null}
          {hasCurrentQuestion ? (
            <button
              type="button"
              onClick={onRevealQuestionText}
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
            onClick={() => onChangeMaterialPage("PREV")}
            disabled={!canGoPrev}
            className="inline-flex h-10 items-center justify-center rounded-md border border-slate-300 bg-white px-4 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-50 disabled:cursor-not-allowed disabled:bg-slate-100 disabled:text-slate-400"
          >
            上一页
          </button>
          <button
            type="button"
            onClick={() => onChangeMaterialPage("NEXT")}
            disabled={!canGoNext}
            className="inline-flex h-10 items-center justify-center rounded-md border border-slate-300 bg-white px-4 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-50 disabled:cursor-not-allowed disabled:bg-slate-100 disabled:text-slate-400"
          >
            下一页
          </button>
        </div>
      </div>
    </section>
  );
}
