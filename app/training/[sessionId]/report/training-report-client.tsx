"use client";

import { ReportTabNavigation } from "./report-ui";
import { ReportTabContent } from "./report-tab-content";
import { useReportAnalysisGeneration } from "./use-report-analysis-generation";
import { useReportAnalysisSummary } from "./use-report-analysis-summary";
import { useReportQaTranscripts } from "./use-report-qa-transcripts";
import { useReportPitchTranscript } from "./use-report-pitch-transcript";
import { useReportTabState } from "./use-report-tab-state";
import { assessTrainingValidity } from "./report-validity";
import { getReportScoreDisplayState } from "./report-score-display";
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
  const trainingValidity = assessTrainingValidity(recording, qaQuestions);
  const scoreDisplay = getReportScoreDisplayState(analysis, trainingValidity);
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
  } = useReportAnalysisSummary({ analysis, scoreDisplay });

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
        contentRef={contentRef}
        tabState={{
          activeTab,
          showAllCoverage,
          onToggleShowAllCoverage: toggleShowAllCoverage,
        }}
        sessionState={{
          isAborted,
          isQaCompleted,
          qaStartedAt,
          qaEndedAt,
          qaDurationSec,
          qaQuestions,
          recording,
        }}
        analysisState={{
          analysis,
          strengths,
          weaknesses,
          suggestions,
          contentCoverage,
          onePageSummary,
          diagnostics,
          actionItems,
          nextTrainingTasks,
          scoreDisplay,
          copySummaryMessage,
          isAnalysisLoading,
          analysisMessage,
          reportGenerationElapsedMs,
          canRetryAnalysisGeneration,
          onCopyOnePageSummary: () => {
            void copyOnePageSummary();
          },
          onRetryAnalysisGeneration: retryAnalysisGeneration,
        }}
        pitchTranscriptState={{
          transcript,
          transcriptDraft,
          isTranscriptEditing,
          isTranscriptSaving,
          transcriptMessage,
          transcriptExpanded,
          onStartTranscriptEditing: startTranscriptEditing,
          onToggleTranscriptExpanded: toggleTranscriptExpanded,
          onTranscriptDraftChange: setTranscriptDraft,
          onCancelTranscriptEditing: cancelTranscriptEditing,
          onSaveTranscript: () => void saveTranscript(),
        }}
        qaTranscriptState={{
          qaTranscripts,
          qaTranscribingSet,
          expandedTranscripts,
          onToggleTranscriptExpand: toggleTranscriptExpand,
          onRetryQaTranscribe: (recordingId) => {
            void retryQaTranscribe(recordingId);
          },
        }}
      />
    </div>
  );
}
