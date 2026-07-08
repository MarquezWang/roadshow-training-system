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
import type { ReportScoreDisplayState } from "./report-score-display";
import type { ReportAnalysisSummaryResult } from "./use-report-analysis-summary";
import type { ReportPitchTranscript } from "./use-report-pitch-transcript";
import {
  type ReportTrainingAnalysis as TrainingAnalysis,
  type TrainingQaQuestion,
  type TrainingRecording,
} from "./report-types";
import type { ReportTabKey } from "./report-ui";

type ReportTabState = Readonly<{
  activeTab: ReportTabKey;
  onChange: (tab: ReportTabKey) => void;
  showAllCoverage: boolean;
  onToggleShowAllCoverage: () => void;
}>;

type ReportSessionState = Readonly<{
  isAborted: boolean;
  isQaCompleted: boolean;
  qaStartedAt: string | null;
  qaEndedAt: string | null;
  qaDurationSec: number | null;
  qaQuestions: TrainingQaQuestion[];
  recording: TrainingRecording | null;
}>;

type ReportAnalysisState = Readonly<{
  analysis: TrainingAnalysis | null;
  strengths: string[];
  weaknesses: string[];
  suggestions: string[];
  contentCoverage: ReportAnalysisSummaryResult["contentCoverage"];
  onePageSummary: ReportAnalysisSummaryResult["onePageSummary"];
  diagnostics: ReportAnalysisSummaryResult["diagnostics"];
  actionItems: ReportAnalysisSummaryResult["actionItems"];
  nextTrainingTasks: ReportAnalysisSummaryResult["nextTrainingTasks"];
  scoreDisplay: ReportScoreDisplayState;
  copySummaryMessage: string;
  isAnalysisLoading: boolean;
  analysisMessage: string;
  reportGenerationElapsedMs: number;
  canRetryAnalysisGeneration: boolean;
  onCopyOnePageSummary: () => void;
  onRetryAnalysisGeneration: () => void;
}>;

type ReportPitchTranscriptState = Readonly<{
  transcript: ReportPitchTranscript | null;
  transcriptDraft: string;
  isTranscriptEditing: boolean;
  isTranscriptSaving: boolean;
  transcriptMessage: string;
  transcriptExpanded: boolean;
  onStartTranscriptEditing: () => void;
  onToggleTranscriptExpanded: () => void;
  onTranscriptDraftChange: (value: string) => void;
  onCancelTranscriptEditing: () => void;
  onSaveTranscript: () => void;
}>;

type ReportQaTranscriptState = Readonly<{
  qaTranscripts: Record<string, QaTranscript | null | undefined>;
  qaTranscribingSet: Set<string>;
  expandedTranscripts: Set<string>;
  onToggleTranscriptExpand: (questionId: string) => void;
  onRetryQaTranscribe: (recordingId: string) => void;
}>;

type ReportTabContentProps = Readonly<{
  contentRef: RefObject<HTMLDivElement | null>;
  tabState: ReportTabState;
  sessionState: ReportSessionState;
  analysisState: ReportAnalysisState;
  pitchTranscriptState: ReportPitchTranscriptState;
  qaTranscriptState: ReportQaTranscriptState;
}>;

export function ReportTabContent({
  contentRef,
  tabState,
  sessionState,
  analysisState,
  pitchTranscriptState,
  qaTranscriptState,
}: ReportTabContentProps) {
  const qaTabData = getReportQaTabData(
    sessionState.qaQuestions,
    analysisState.analysis,
  );

  return (
    <div ref={contentRef} className="scroll-mt-14">
      {tabState.activeTab === "abort-overview" && (
        <ReportAbortOverviewTab
          recording={sessionState.recording}
          qaQuestions={sessionState.qaQuestions}
        />
      )}

      {tabState.activeTab === "abort-pitch" && (
        <ReportAbortPitchTab
          recording={sessionState.recording}
          transcriptExpanded={pitchTranscriptState.transcriptExpanded}
          onToggleTranscriptExpanded={() =>
            pitchTranscriptState.onToggleTranscriptExpanded()
          }
        />
      )}

      {tabState.activeTab === "abort-qa" && (
        <ReportAbortQaTab
          qaQuestions={sessionState.qaQuestions}
          expandedTranscripts={qaTranscriptState.expandedTranscripts}
          qaTranscribingSet={qaTranscriptState.qaTranscribingSet}
          onToggleTranscriptExpand={qaTranscriptState.onToggleTranscriptExpand}
          onRetryQaTranscribe={(recordingId) => {
            qaTranscriptState.onRetryQaTranscribe(recordingId);
          }}
        />
      )}

      {tabState.activeTab === "overview" && (
        <ReportOverviewTab
          analysis={analysisState.analysis}
          onePageSummary={analysisState.onePageSummary}
          diagnostics={analysisState.diagnostics}
          actionItems={analysisState.actionItems}
          nextTrainingTasks={analysisState.nextTrainingTasks}
          scoreDisplay={analysisState.scoreDisplay}
          copySummaryMessage={analysisState.copySummaryMessage}
          isAborted={sessionState.isAborted}
          isAnalysisLoading={analysisState.isAnalysisLoading}
          analysisMessage={analysisState.analysisMessage}
          reportGenerationElapsedMs={analysisState.reportGenerationElapsedMs}
          canRetryAnalysisGeneration={
            analysisState.canRetryAnalysisGeneration
          }
          onCopyOnePageSummary={analysisState.onCopyOnePageSummary}
          onOpenPitchTab={() => tabState.onChange("pitch")}
          onOpenQaTab={() => tabState.onChange("qa")}
          onRetryAnalysisGeneration={analysisState.onRetryAnalysisGeneration}
        />
      )}

      {tabState.activeTab === "pitch" && (
        <ReportPitchTab
          analysis={analysisState.analysis}
          transcript={pitchTranscriptState.transcript}
          scoreDisplay={analysisState.scoreDisplay}
          strengths={analysisState.strengths}
          weaknesses={analysisState.weaknesses}
          suggestions={analysisState.suggestions}
          contentCoverage={analysisState.contentCoverage}
          showAllCoverage={tabState.showAllCoverage}
          isAborted={sessionState.isAborted}
          recording={sessionState.recording}
          isTranscriptEditing={pitchTranscriptState.isTranscriptEditing}
          isTranscriptSaving={pitchTranscriptState.isTranscriptSaving}
          transcriptDraft={pitchTranscriptState.transcriptDraft}
          transcriptExpanded={pitchTranscriptState.transcriptExpanded}
          transcriptMessage={pitchTranscriptState.transcriptMessage}
          onToggleShowAllCoverage={tabState.onToggleShowAllCoverage}
          onStartTranscriptEditing={
            pitchTranscriptState.onStartTranscriptEditing
          }
          onToggleTranscriptExpanded={
            pitchTranscriptState.onToggleTranscriptExpanded
          }
          onTranscriptDraftChange={
            pitchTranscriptState.onTranscriptDraftChange
          }
          onCancelTranscriptEditing={
            pitchTranscriptState.onCancelTranscriptEditing
          }
          onSaveTranscript={pitchTranscriptState.onSaveTranscript}
        />
      )}

      {tabState.activeTab === "qa" && (
        <ReportQaTab
          enteredQuestions={qaTabData.enteredQuestions}
          dynamicFollowupQuestion={qaTabData.dynamicFollowupQuestion}
          dynamicFollowupReview={qaTabData.dynamicFollowupReview}
          enteredQaReviews={qaTabData.enteredQaReviews}
          skippedCount={qaTabData.skippedCount}
          suggestions={analysisState.suggestions}
          qaTranscripts={qaTranscriptState.qaTranscripts}
          qaTranscribingSet={qaTranscriptState.qaTranscribingSet}
          expandedTranscripts={qaTranscriptState.expandedTranscripts}
          isAborted={sessionState.isAborted}
          isQaCompleted={sessionState.isQaCompleted}
          qaStartedAt={sessionState.qaStartedAt}
          qaEndedAt={sessionState.qaEndedAt}
          qaDurationSec={sessionState.qaDurationSec}
          onToggleTranscriptExpand={qaTranscriptState.onToggleTranscriptExpand}
          onRetryQaTranscribe={(recordingId) => {
            qaTranscriptState.onRetryQaTranscribe(recordingId);
          }}
        />
      )}
    </div>
  );
}
