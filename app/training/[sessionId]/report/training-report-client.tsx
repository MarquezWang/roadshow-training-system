"use client";

import { ReportTabNavigation } from "./report-ui";
import { ReportTabContent } from "./report-tab-content";
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
      <ReportTabContent
        activeTab={activeTab}
        contentRef={contentRef}
        isAborted={isAborted}
        isQaCompleted={isQaCompleted}
        qaStartedAt={qaStartedAt}
        qaEndedAt={qaEndedAt}
        qaDurationSec={qaDurationSec}
        qaQuestions={qaQuestions}
        recording={recording}
        analysis={analysis}
        strengths={strengths}
        weaknesses={weaknesses}
        suggestions={suggestions}
        contentCoverage={contentCoverage}
        onePageSummary={onePageSummary}
        diagnostics={diagnostics}
        actionItems={actionItems}
        nextTrainingTasks={nextTrainingTasks}
        copySummaryMessage={copySummaryMessage}
        isAnalysisLoading={isAnalysisLoading}
        analysisMessage={analysisMessage}
        reportGenerationElapsedMs={reportGenerationElapsedMs}
        canRetryAnalysisGeneration={canRetryAnalysisGeneration}
        transcript={transcript}
        transcriptDraft={transcriptDraft}
        isTranscriptEditing={isTranscriptEditing}
        isTranscriptSaving={isTranscriptSaving}
        transcriptMessage={transcriptMessage}
        transcriptExpanded={transcriptExpanded}
        showAllCoverage={showAllCoverage}
        qaTranscripts={qaTranscripts}
        qaTranscribingSet={qaTranscribingSet}
        expandedTranscripts={expandedTranscripts}
        onCopyOnePageSummary={() => {
          void copyOnePageSummary();
        }}
        onRetryAnalysisGeneration={retryAnalysisGeneration}
        onToggleShowAllCoverage={toggleShowAllCoverage}
        onStartTranscriptEditing={startTranscriptEditing}
        onToggleTranscriptExpanded={toggleTranscriptExpanded}
        onTranscriptDraftChange={setTranscriptDraft}
        onCancelTranscriptEditing={cancelTranscriptEditing}
        onSaveTranscript={() => void saveTranscript()}
        onToggleTranscriptExpand={toggleTranscriptExpand}
        onRetryQaTranscribe={(recordingId) => {
          void retryQaTranscribe(recordingId);
        }}
      />
    </div>
  );
}
