"use client";

import { ReportOverviewActionItems } from "./report-overview-action-items";
import { ReportOverviewDiagnostics } from "./report-overview-diagnostics";
import { ReportOverviewNextTasks } from "./report-overview-next-tasks";
import { ReportOverviewStatusPanel } from "./report-overview-status-panel";
import { ReportOverviewSummary } from "./report-overview-summary";

type OverviewAnalysis = {
  status: string;
  overallScore: number | null;
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
  validityMessage: string | null;
  copySummaryMessage: string;
  isAborted: boolean;
  isAnalysisLoading: boolean;
  analysisMessage: string;
  reportGenerationElapsedMs: number;
  canRetryAnalysisGeneration: boolean;
  onCopyOnePageSummary: () => void;
  onRetryAnalysisGeneration: () => void;
}>;

export function ReportOverviewTab({
  analysis,
  onePageSummary,
  diagnostics,
  actionItems,
  nextTrainingTasks,
  validityMessage,
  copySummaryMessage,
  isAborted,
  isAnalysisLoading,
  analysisMessage,
  reportGenerationElapsedMs,
  canRetryAnalysisGeneration,
  onCopyOnePageSummary,
  onRetryAnalysisGeneration,
}: ReportOverviewTabProps) {
  return (
    <div className="grid gap-6">
      {analysis?.status === "COMPLETED" ? (
        <ReportOverviewSummary
          analysis={analysis}
          onePageSummary={onePageSummary}
          validityMessage={validityMessage}
          copySummaryMessage={copySummaryMessage}
          onCopyOnePageSummary={onCopyOnePageSummary}
        />
      ) : null}

      {analysis?.status === "COMPLETED" ? (
        <ReportOverviewDiagnostics diagnostics={diagnostics} />
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
