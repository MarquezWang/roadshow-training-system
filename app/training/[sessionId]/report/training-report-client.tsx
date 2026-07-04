"use client";

import { ReportTabNavigation } from "./report-ui";
import {
  ReportAbortOverviewTab,
  ReportAbortPitchTab,
  ReportAbortQaTab,
} from "./report-abort";
import { ReportOverviewTab } from "./report-overview";
import { ReportPitchTab } from "./report-pitch";
import { ReportQaTab } from "./report-qa";
import { useReportAnalysisGeneration } from "./use-report-analysis-generation";
import { useReportAnalysisSummary } from "./use-report-analysis-summary";
import { useReportQaTranscripts } from "./use-report-qa-transcripts";
import { useReportPitchTranscript } from "./use-report-pitch-transcript";
import { useReportTabState } from "./use-report-tab-state";
import {
  type ReportTrainingAnalysis as TrainingAnalysis,
  type TrainingQaQuestion,
  type TrainingRecording,
} from "./report-types";
import { getReportQaTabData } from "./report-qa-tab-data";

type TrainingReportClientProps = Readonly<{
  sessionId: string;
  sessionStatus: string;
  qaStartedAt: string | null;
  qaEndedAt: string | null;
  qaDurationSec: number | null;
  qaQuestions: TrainingQaQuestion[];
  recording: TrainingRecording | null;
  initialAnalysis: TrainingAnalysis | null;
}>;

export function TrainingReportClient({
  sessionId,
  sessionStatus,
  qaStartedAt,
  qaEndedAt,
  qaDurationSec,
  qaQuestions,
  recording,
  initialAnalysis,
}: TrainingReportClientProps) {
  const isAborted = sessionStatus === "ABORTED";
  const isQaCompleted =
    sessionStatus === "QA_ENDED" ||
    sessionStatus === "REPORT_READY" ||
    sessionStatus === "FINISHED";
  const {
    transcript,
    transcriptDraft,
    isTranscriptEditing,
    isTranscriptSaving,
    transcriptMessage,
    transcriptExpanded,
    setTranscriptDraft,
    startTranscriptEditing,
    cancelTranscriptEditing,
    toggleTranscriptExpanded,
    saveTranscript,
  } = useReportPitchTranscript({
    sessionId,
    recording,
    isAborted,
  });
  const {
    analysis,
    isAnalysisLoading,
    analysisMessage,
    reportGenerationElapsedMs,
    canRetryAnalysisGeneration,
    retryAnalysisGeneration,
  } = useReportAnalysisGeneration({
    sessionId,
    isAborted,
    initialAnalysis,
  });
  const {
    qaTranscripts,
    qaTranscribingSet,
    expandedTranscripts,
    toggleTranscriptExpand,
    retryQaTranscribe,
  } = useReportQaTranscripts({
    sessionId,
    qaQuestions,
  });
  const {
    activeTab,
    setActiveTab,
    contentRef,
    showAllCoverage,
    toggleShowAllCoverage,
  } = useReportTabState({ isAborted });
  const {
    strengths,
    weaknesses,
    suggestions,
    contentCoverage,
    onePageSummary,
    diagnostics,
    actionItems,
    nextTrainingTasks,
    copySummaryMessage,
    copyOnePageSummary,
  } = useReportAnalysisSummary({ analysis });
  const qaTabData = getReportQaTabData(qaQuestions, analysis);

  return (
    <div className="grid gap-5">
      {/* === Tab 导航（sticky） === */}
      <ReportTabNavigation
        isAborted={isAborted}
        isAnalysisCompleted={analysis?.status === "COMPLETED"}
        activeTab={activeTab}
        onChange={setActiveTab}
      />

      {/* === Tab 内容区 === */}
      <div ref={contentRef} className="scroll-mt-14">
        {/* === 中止态：中止概览 Tab === */}
        {activeTab === "abort-overview" && (
          <ReportAbortOverviewTab
            recording={recording}
            qaQuestions={qaQuestions}
          />
        )}

        {/* === 中止态：路演记录 Tab === */}
        {activeTab === "abort-pitch" && (
          <ReportAbortPitchTab
            recording={recording}
            transcriptExpanded={transcriptExpanded}
            onToggleTranscriptExpanded={() => toggleTranscriptExpanded()}
          />
        )}

        {/* === 中止态：答辩记录 Tab === */}
        {activeTab === "abort-qa" && (
          <ReportAbortQaTab
            qaQuestions={qaQuestions}
            expandedTranscripts={expandedTranscripts}
            qaTranscribingSet={qaTranscribingSet}
            onToggleTranscriptExpand={toggleTranscriptExpand}
            onRetryQaTranscribe={(recordingId) => {
              void retryQaTranscribe(recordingId);
            }}
          />
        )}

        {/* === 总览 Tab === */}
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
            onCopyOnePageSummary={() => {
              void copyOnePageSummary();
            }}
            onRetryAnalysisGeneration={retryAnalysisGeneration}
          />
        )}

        {/* === 路演表现 Tab === */}
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
            onToggleShowAllCoverage={toggleShowAllCoverage}
            onStartTranscriptEditing={startTranscriptEditing}
            onToggleTranscriptExpanded={toggleTranscriptExpanded}
            onTranscriptDraftChange={setTranscriptDraft}
            onCancelTranscriptEditing={cancelTranscriptEditing}
            onSaveTranscript={() => void saveTranscript()}
          />
        )}

        {/* === 答辩表现 Tab === */}
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
            onToggleTranscriptExpand={toggleTranscriptExpand}
            onRetryQaTranscribe={(recordingId) => {
              void retryQaTranscribe(recordingId);
            }}
          />
        )}
      </div>
    </div>
  );
}
