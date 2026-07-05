"use client";

import type { RefObject } from "react";

import {
  ReportAbortOverviewTab,
  ReportAbortPitchTab,
  ReportAbortQaTab,
} from "./report-abort";
import { ReportOverviewTab } from "./report-overview";
import { ReportPitchTab } from "./report-pitch";
import { ReportQaTab } from "./report-qa";
import type { QaTranscript } from "./report-qa-types";
import { getReportQaTabData } from "./report-qa-tab-data";
import type { ReportAnalysisSummaryResult } from "./use-report-analysis-summary";
import type { ReportPitchTranscript } from "./use-report-pitch-transcript";
import {
  type ReportTrainingAnalysis as TrainingAnalysis,
  type TrainingQaQuestion,
  type TrainingRecording,
} from "./report-types";
import type { ReportTabKey } from "./report-ui";

type ReportTabContentProps = Readonly<{
  activeTab: ReportTabKey;
  contentRef: RefObject<HTMLDivElement | null>;
  isAborted: boolean;
  isQaCompleted: boolean;
  qaStartedAt: string | null;
  qaEndedAt: string | null;
  qaDurationSec: number | null;
  qaQuestions: TrainingQaQuestion[];
  recording: TrainingRecording | null;
  analysis: TrainingAnalysis | null;
  strengths: string[];
  weaknesses: string[];
  suggestions: string[];
  contentCoverage: ReportAnalysisSummaryResult["contentCoverage"];
  onePageSummary: ReportAnalysisSummaryResult["onePageSummary"];
  diagnostics: ReportAnalysisSummaryResult["diagnostics"];
  actionItems: ReportAnalysisSummaryResult["actionItems"];
  nextTrainingTasks: ReportAnalysisSummaryResult["nextTrainingTasks"];
  copySummaryMessage: string;
  isAnalysisLoading: boolean;
  analysisMessage: string;
  reportGenerationElapsedMs: number;
  canRetryAnalysisGeneration: boolean;
  transcript: ReportPitchTranscript | null;
  transcriptDraft: string;
  isTranscriptEditing: boolean;
  isTranscriptSaving: boolean;
  transcriptMessage: string;
  transcriptExpanded: boolean;
  showAllCoverage: boolean;
  qaTranscripts: Record<string, QaTranscript | null | undefined>;
  qaTranscribingSet: Set<string>;
  expandedTranscripts: Set<string>;
  onCopyOnePageSummary: () => void;
  onRetryAnalysisGeneration: () => void;
  onToggleShowAllCoverage: () => void;
  onStartTranscriptEditing: () => void;
  onToggleTranscriptExpanded: () => void;
  onTranscriptDraftChange: (value: string) => void;
  onCancelTranscriptEditing: () => void;
  onSaveTranscript: () => void;
  onToggleTranscriptExpand: (questionId: string) => void;
  onRetryQaTranscribe: (recordingId: string) => void;
}>;

export function ReportTabContent({
  activeTab,
  contentRef,
  isAborted,
  isQaCompleted,
  qaStartedAt,
  qaEndedAt,
  qaDurationSec,
  qaQuestions,
  recording,
  analysis,
  strengths,
  weaknesses,
  suggestions,
  contentCoverage,
  onePageSummary,
  diagnostics,
  actionItems,
  nextTrainingTasks,
  copySummaryMessage,
  isAnalysisLoading,
  analysisMessage,
  reportGenerationElapsedMs,
  canRetryAnalysisGeneration,
  transcript,
  transcriptDraft,
  isTranscriptEditing,
  isTranscriptSaving,
  transcriptMessage,
  transcriptExpanded,
  showAllCoverage,
  qaTranscripts,
  qaTranscribingSet,
  expandedTranscripts,
  onCopyOnePageSummary,
  onRetryAnalysisGeneration,
  onToggleShowAllCoverage,
  onStartTranscriptEditing,
  onToggleTranscriptExpanded,
  onTranscriptDraftChange,
  onCancelTranscriptEditing,
  onSaveTranscript,
  onToggleTranscriptExpand,
  onRetryQaTranscribe,
}: ReportTabContentProps) {
  const qaTabData = getReportQaTabData(qaQuestions, analysis);

  return (
    <div ref={contentRef} className="scroll-mt-14">
      {activeTab === "abort-overview" && (
        <ReportAbortOverviewTab recording={recording} qaQuestions={qaQuestions} />
      )}

      {activeTab === "abort-pitch" && (
        <ReportAbortPitchTab
          recording={recording}
          transcriptExpanded={transcriptExpanded}
          onToggleTranscriptExpanded={() => onToggleTranscriptExpanded()}
        />
      )}

      {activeTab === "abort-qa" && (
        <ReportAbortQaTab
          qaQuestions={qaQuestions}
          expandedTranscripts={expandedTranscripts}
          qaTranscribingSet={qaTranscribingSet}
          onToggleTranscriptExpand={onToggleTranscriptExpand}
          onRetryQaTranscribe={(recordingId) => {
            onRetryQaTranscribe(recordingId);
          }}
        />
      )}

      {activeTab === "overview" && (
        <ReportOverviewTab
          analysis={analysis}
          onePageSummary={onePageSummary}
          diagnostics={diagnostics}
          actionItems={actionItems}
          nextTrainingTasks={nextTrainingTasks}
          copySummaryMessage={copySummaryMessage}
          isAborted={isAborted}
          isAnalysisLoading={isAnalysisLoading}
          analysisMessage={analysisMessage}
          reportGenerationElapsedMs={reportGenerationElapsedMs}
          canRetryAnalysisGeneration={canRetryAnalysisGeneration}
          onCopyOnePageSummary={onCopyOnePageSummary}
          onRetryAnalysisGeneration={onRetryAnalysisGeneration}
        />
      )}

      {activeTab === "pitch" && (
        <ReportPitchTab
          analysis={analysis}
          transcript={transcript}
          strengths={strengths}
          weaknesses={weaknesses}
          suggestions={suggestions}
          contentCoverage={contentCoverage}
          showAllCoverage={showAllCoverage}
          isAborted={isAborted}
          recording={recording}
          isTranscriptEditing={isTranscriptEditing}
          isTranscriptSaving={isTranscriptSaving}
          transcriptDraft={transcriptDraft}
          transcriptExpanded={transcriptExpanded}
          transcriptMessage={transcriptMessage}
          onToggleShowAllCoverage={onToggleShowAllCoverage}
          onStartTranscriptEditing={onStartTranscriptEditing}
          onToggleTranscriptExpanded={onToggleTranscriptExpanded}
          onTranscriptDraftChange={onTranscriptDraftChange}
          onCancelTranscriptEditing={onCancelTranscriptEditing}
          onSaveTranscript={onSaveTranscript}
        />
      )}

      {activeTab === "qa" && (
        <ReportQaTab
          enteredQuestions={qaTabData.enteredQuestions}
          dynamicFollowupQuestion={qaTabData.dynamicFollowupQuestion}
          dynamicFollowupReview={qaTabData.dynamicFollowupReview}
          enteredQaReviews={qaTabData.enteredQaReviews}
          skippedCount={qaTabData.skippedCount}
          suggestions={suggestions}
          qaTranscripts={qaTranscripts}
          qaTranscribingSet={qaTranscribingSet}
          expandedTranscripts={expandedTranscripts}
          isAborted={isAborted}
          isQaCompleted={isQaCompleted}
          qaStartedAt={qaStartedAt}
          qaEndedAt={qaEndedAt}
          qaDurationSec={qaDurationSec}
          onToggleTranscriptExpand={onToggleTranscriptExpand}
          onRetryQaTranscribe={(recordingId) => {
            onRetryQaTranscribe(recordingId);
          }}
        />
      )}
    </div>
  );
}
