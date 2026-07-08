"use client";

import {
  REPORT_GENERATION_FAILURE_MESSAGE,
  ReportGenerationPanel,
} from "./report-ui";

type OverviewAnalysisStatus = {
  status: string;
};

type ReportOverviewStatusPanelProps = Readonly<{
  analysis: OverviewAnalysisStatus | null;
  isAborted: boolean;
  isAnalysisLoading: boolean;
  analysisMessage: string;
  reportGenerationElapsedMs: number;
  canRetryAnalysisGeneration: boolean;
  onRetryAnalysisGeneration: () => void;
}>;

function getRetryHint(canRetryAnalysisGeneration: boolean) {
  return canRetryAnalysisGeneration
    ? "系统检测到上一次报告生成可能已中断，可以重新触发生成。"
    : undefined;
}

function ReportGenerationSection({
  message,
  elapsedMs,
  canRetry,
  onRetry,
}: Readonly<{
  message: string;
  elapsedMs: number;
  canRetry: boolean;
  onRetry: () => void;
}>) {
  return (
    <section className="rounded-lg border border-slate-800 bg-slate-950/40 p-4 shadow-sm">
      <ReportGenerationPanel
        message={message}
        elapsedMs={elapsedMs}
        canRetry={canRetry}
        retryHint={getRetryHint(canRetry)}
        onRetry={onRetry}
      />
    </section>
  );
}

export function ReportOverviewStatusPanel({
  analysis,
  isAborted,
  isAnalysisLoading,
  analysisMessage,
  reportGenerationElapsedMs,
  canRetryAnalysisGeneration,
  onRetryAnalysisGeneration,
}: ReportOverviewStatusPanelProps) {
  if (analysis?.status === "COMPLETED") {
    return null;
  }

  if (isAborted) {
    return (
      <section className="rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
        <div className="rounded-md border border-red-100 bg-red-50 p-5">
          <p className="text-sm font-medium text-red-700">本轮训练已中止</p>
          <p className="mt-1 text-sm text-red-600/80">
            本轮训练在正式流程中被中止，已完成内容会保留，但不能继续本轮路演或答辩。
          </p>
        </div>
      </section>
    );
  }

  if (isAnalysisLoading) {
    return (
      <ReportGenerationSection
        message={analysisMessage}
        elapsedMs={reportGenerationElapsedMs}
        canRetry={canRetryAnalysisGeneration}
        onRetry={onRetryAnalysisGeneration}
      />
    );
  }

  if (analysis?.status === "FAILED") {
    return (
      <section className="rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
        <div className="py-8 text-center">
          <p className="text-sm font-medium text-red-600">报告生成失败</p>
          <p className="mt-1 text-xs text-red-400">
            {REPORT_GENERATION_FAILURE_MESSAGE}
          </p>
          <button
            type="button"
            onClick={onRetryAnalysisGeneration}
            disabled={isAnalysisLoading}
            className="mt-4 inline-flex h-8 items-center justify-center rounded border border-red-200 bg-white px-3 text-xs font-medium text-red-600 transition-colors hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-50"
          >
            重试生成报告
          </button>
        </div>
      </section>
    );
  }

  if (analysis) {
    return (
      <ReportGenerationSection
        message={analysisMessage}
        elapsedMs={reportGenerationElapsedMs}
        canRetry={canRetryAnalysisGeneration}
        onRetry={onRetryAnalysisGeneration}
      />
    );
  }

  return (
    <ReportGenerationSection
      message={analysisMessage || "正在准备报告数据，请稍候……"}
      elapsedMs={reportGenerationElapsedMs}
      canRetry={canRetryAnalysisGeneration}
      onRetry={onRetryAnalysisGeneration}
    />
  );
}
