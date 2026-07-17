import type { RefObject } from "react";
import { formatReplayTime } from "./training-replay-flow";
import type {
  PitchReplaySegment,
  ReplayPageControlItem,
  ReplayPreviewFile,
} from "./training-replay-types";

type TrainingReplayStageProps = Readonly<{
  previewFile: ReplayPreviewFile | null;
  previewNotice: string | null;
  currentReplaySegment: PitchReplaySegment | null;
  replayTotalPages: number | null;
  pitchReplaySegments: PitchReplaySegment[];
  replayPageControlItems: ReplayPageControlItem[];
  safeReplayPageIndex: number;
  isReplayPdfLoading: boolean;
  replayPdfError: string;
  previewContainerRef: RefObject<HTMLDivElement | null>;
  canvasRef: RefObject<HTMLCanvasElement | null>;
  onPreviousPage: () => void;
  onNextPage: () => void;
  onSelectPage: (index: number) => void;
}>;

export function TrainingReplayStage({
  previewFile,
  previewNotice,
  currentReplaySegment,
  replayTotalPages,
  pitchReplaySegments,
  replayPageControlItems,
  safeReplayPageIndex,
  isReplayPdfLoading,
  replayPdfError,
  previewContainerRef,
  canvasRef,
  onPreviousPage,
  onNextPage,
  onSelectPage,
}: TrainingReplayStageProps) {
  return (
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
              : (previewNotice ?? "未记录可回放的页面片段。")}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={onPreviousPage}
            disabled={safeReplayPageIndex <= 0}
            className="rounded-md border border-slate-700 px-3 py-1.5 text-xs font-medium text-slate-200 transition-colors hover:bg-slate-900 disabled:cursor-not-allowed disabled:opacity-40"
          >
            上一页
          </button>
          <button
            type="button"
            onClick={onNextPage}
            disabled={safeReplayPageIndex >= pitchReplaySegments.length - 1}
            className="rounded-md border border-slate-700 px-3 py-1.5 text-xs font-medium text-slate-200 transition-colors hover:bg-slate-900 disabled:cursor-not-allowed disabled:opacity-40"
          >
            下一页
          </button>
        </div>
      </div>

      <div
        ref={previewContainerRef}
        className="relative flex h-[72vh] min-h-[600px] items-center justify-center overflow-hidden rounded-md border border-slate-800 bg-slate-950 p-3"
      >
        {previewFile && currentReplaySegment ? (
          <>
            <canvas
              ref={canvasRef}
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
                onClick={() => onSelectPage(item)}
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
  );
}
