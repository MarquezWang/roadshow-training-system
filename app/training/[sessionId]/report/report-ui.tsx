"use client";

import type { ReactNode, RefObject } from "react";

export type ReportTabKey =
  | "overview"
  | "pitch"
  | "qa"
  | "abort-overview"
  | "abort-pitch"
  | "abort-qa";

export const REPORT_GENERATION_FAILURE_MESSAGE =
  "报告生成失败，请稍后重试或返回项目详情重新开始训练。";

const REPORT_GENERATION_STAGES = [
  "正在整理路演转写与答辩记录",
  "正在分析路演表达、内容完整度与答辩表现",
  "正在生成评分、评语与改进建议",
];

function getReportGenerationStageIndex(elapsedMs: number) {
  return Math.floor(elapsedMs / 30_000) % REPORT_GENERATION_STAGES.length;
}

export function ReportGenerationPanel({
  message,
  elapsedMs,
  canRetry = false,
  retryLabel = "重新生成报告",
  retryHint,
  onRetry,
}: Readonly<{
  message: string;
  elapsedMs: number;
  canRetry?: boolean;
  retryLabel?: string;
  retryHint?: string;
  onRetry?: () => void;
}>) {
  const activeStageIndex = getReportGenerationStageIndex(elapsedMs);
  const isTakingLongerThanExpected = elapsedMs >= 120_000;

  return (
    <div className="rounded-lg border border-slate-700 bg-slate-950 p-5 text-left shadow-sm">
      <div className="flex items-start gap-4">
        <div className="mt-1 h-8 w-8 shrink-0 animate-spin rounded-full border-2 border-slate-700 border-t-blue-400" />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-white">报告生成中</p>
          <p className="mt-1 text-sm leading-6 text-slate-300">
            {message || REPORT_GENERATION_STAGES[activeStageIndex]}
          </p>
          <div className="mt-4 space-y-2">
            {REPORT_GENERATION_STAGES.map((stage, index) => (
              <div key={stage} className="flex items-center gap-3 text-sm">
                <span
                  className={
                    index === activeStageIndex
                      ? "h-2.5 w-2.5 rounded-full bg-blue-400 shadow-[0_0_0_4px_rgba(96,165,250,0.16)]"
                      : "h-2.5 w-2.5 rounded-full bg-slate-700"
                  }
                />
                <span
                  className={
                    index === activeStageIndex
                      ? "text-slate-100"
                      : "text-slate-500"
                  }
                >
                  {stage}
                </span>
              </div>
            ))}
          </div>
          <p className="mt-4 rounded-md border border-slate-800 bg-slate-900 px-3 py-2 text-xs leading-5 text-slate-400">
            报告生成通常需要 1-3 分钟，请勿刷新页面。完成后页面会自动更新。
          </p>
          {isTakingLongerThanExpected && !canRetry ? (
            <p className="mt-3 rounded-md border border-blue-400/20 bg-blue-400/10 px-3 py-2 text-xs leading-5 text-blue-100">
              当前报告生成耗时较长，系统仍在检查生成结果。如果期间服务被重启，
              系统会在检测到中断后自动重新生成。
            </p>
          ) : null}
          {canRetry ? (
            <div className="mt-4 rounded-md border border-amber-500/30 bg-amber-500/10 p-3">
              <p className="text-xs leading-5 text-amber-100">
                {retryHint ||
                  "如果页面长时间停留在生成中，可能是上一次生成请求被中断。你可以重新触发生成。"}
              </p>
              <button
                type="button"
                onClick={onRetry}
                className="mt-3 inline-flex h-8 items-center justify-center rounded border border-amber-300/40 bg-amber-300 px-3 text-xs font-medium text-slate-950 transition-colors hover:bg-amber-200"
              >
                {retryLabel}
              </button>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}

export function ReportTabNavigation({
  isAborted,
  isAnalysisCompleted,
  activeTab,
  onChange,
}: Readonly<{
  isAborted: boolean;
  isAnalysisCompleted: boolean;
  activeTab: ReportTabKey;
  onChange: (tab: ReportTabKey) => void;
}>) {
  const tabs: Array<{ key: ReportTabKey; label: string }> = isAborted
    ? [
        { key: "abort-overview", label: "中止概览" },
        { key: "abort-pitch", label: "路演记录" },
        { key: "abort-qa", label: "答辩记录" },
      ]
    : isAnalysisCompleted
      ? [
          { key: "overview", label: "总览" },
          { key: "pitch", label: "路演表现" },
          { key: "qa", label: "答辩表现" },
        ]
      : [];

  if (tabs.length === 0) {
    return null;
  }

  return (
    <nav className="sticky top-0 z-10 -mx-6 border-b border-[var(--border)] bg-[var(--surface)]/95 px-6 backdrop-blur sm:-mx-8 sm:px-8 lg:-mx-10 lg:px-10">
      {tabs.map((tab) => (
        <button
          key={tab.key}
          type="button"
          onClick={() => onChange(tab.key)}
          className={`relative -mb-px px-4 py-2.5 text-sm font-medium transition-colors ${
            activeTab === tab.key
              ? "border-b-2 border-teal-300 text-[var(--surface-foreground)]"
              : "text-[var(--muted-foreground)] hover:text-[var(--surface-foreground)]"
          }`}
        >
          {tab.label}
        </button>
      ))}
    </nav>
  );
}

export function ReportContentContainer({
  contentRef,
  children,
}: Readonly<{
  contentRef: RefObject<HTMLDivElement | null>;
  children: ReactNode;
}>) {
  return (
    <div ref={contentRef} className="scroll-mt-14">
      {children}
    </div>
  );
}
