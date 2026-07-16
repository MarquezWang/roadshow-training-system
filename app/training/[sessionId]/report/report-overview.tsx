"use client";

import { ReportOverviewActionItems } from "./report-overview-action-items";
import { ReportOverviewDiagnostics } from "./report-overview-diagnostics";
import { ReportOverviewNextTasks } from "./report-overview-next-tasks";
import { ReportOverviewStatusPanel } from "./report-overview-status-panel";
import { ReportOverviewSummary } from "./report-overview-summary";
import type { ReportScoreDisplayState } from "./report-score-display";

type OverviewAnalysis = {
  status: string;
  overallScore: number | null;
  isFallbackReport: boolean;
  summary: string;
};

type OnePageSummary = {
  conclusion: string;
  strongestPoint: string;
  biggestWeakness: string;
  nextTrainingFocus: string;
  readinessAdvice: string;
};

type Diagnostics = {
  content: string[];
  delivery: string[];
  qa: string[];
};

type ActionItem = {
  issue: string;
  whyItMatters: string;
  howToFix: string;
  sampleWording: string;
};

type ReportOverviewTabProps = Readonly<{
  analysis: OverviewAnalysis | null;
  onePageSummary: OnePageSummary;
  diagnostics: Diagnostics;
  actionItems: ActionItem[];
  nextTrainingTasks: string[];
  scoreDisplay: ReportScoreDisplayState;
  copySummaryMessage: string;
  isAborted: boolean;
  isAnalysisLoading: boolean;
  analysisMessage: string;
  reportGenerationElapsedMs: number;
  canRetryAnalysisGeneration: boolean;
  onCopyOnePageSummary: () => void;
  onOpenPitchTab: () => void;
  onOpenQaTab: () => void;
  onRetryAnalysisGeneration: () => void;
}>;

export function ReportOverviewTab({
  analysis,
  onePageSummary,
  diagnostics,
  actionItems,
  nextTrainingTasks,
  scoreDisplay,
  copySummaryMessage,
  isAborted,
  isAnalysisLoading,
  analysisMessage,
  reportGenerationElapsedMs,
  canRetryAnalysisGeneration,
  onCopyOnePageSummary,
  onOpenPitchTab,
  onOpenQaTab,
  onRetryAnalysisGeneration,
}: ReportOverviewTabProps) {
  return (
    <div className="grid gap-6">
      {analysis?.status === "COMPLETED" ? (
        <ReportOverviewSummary
          analysis={analysis}
          onePageSummary={onePageSummary}
          scoreDisplay={scoreDisplay}
          copySummaryMessage={copySummaryMessage}
          onCopyOnePageSummary={onCopyOnePageSummary}
        />
      ) : null}

      {analysis?.status === "COMPLETED" &&
      analysis.isFallbackReport &&
      !isAborted ? (
        <section className="rounded-lg border border-amber-300/30 bg-amber-300/10 p-4 text-amber-100">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="text-sm font-semibold">当前为降级报告</p>
              <p className="mt-1 text-xs leading-5 text-amber-100/80">
                系统已保留现有报告。你可以重新请求 AI 生成完整结构，失败时不会覆盖上一份报告。
              </p>
            </div>
            <button
              type="button"
              onClick={onRetryAnalysisGeneration}
              disabled={isAnalysisLoading}
              className="inline-flex h-9 shrink-0 items-center justify-center rounded-md border border-amber-200/40 bg-amber-100/10 px-4 text-xs font-semibold transition-colors hover:bg-amber-100/20 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {isAnalysisLoading ? "正在重新生成……" : "重新生成完整报告"}
            </button>
          </div>
        </section>
      ) : null}

      {analysis?.status === "COMPLETED" ? (
        <ReportOverviewDiagnostics
          diagnostics={diagnostics}
          onOpenPitchTab={onOpenPitchTab}
          onOpenQaTab={onOpenQaTab}
        />
      ) : null}

      {analysis?.status === "COMPLETED" && actionItems.length > 0 ? (
        <ReportOverviewActionItems actionItems={actionItems} />
      ) : null}

      {analysis?.status === "COMPLETED" && nextTrainingTasks.length > 0 ? (
        <ReportOverviewNextTasks nextTrainingTasks={nextTrainingTasks} />
      ) : null}

      <ReportOverviewStatusPanel
        analysis={analysis}
        isAborted={isAborted}
        isAnalysisLoading={isAnalysisLoading}
        analysisMessage={analysisMessage}
        reportGenerationElapsedMs={reportGenerationElapsedMs}
        canRetryAnalysisGeneration={canRetryAnalysisGeneration}
        onRetryAnalysisGeneration={onRetryAnalysisGeneration}
      />
    </div>
  );
}
