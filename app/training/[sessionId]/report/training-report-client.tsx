"use client";

import { useEffect, useRef, useState } from "react";
import { ReportTabNavigation, type ReportTabKey } from "./report-ui";
import {
  ReportAbortOverviewTab,
  ReportAbortPitchTab,
  ReportAbortQaTab,
} from "./report-abort";
import { ReportOverviewTab } from "./report-overview";
import { ReportPitchTab } from "./report-pitch";
import { ReportQaTab } from "./report-qa";
import {
  useReportAnalysisGeneration,
  type ReportTrainingAnalysis as TrainingAnalysis,
} from "./use-report-analysis-generation";
import { useReportAnalysisSummary } from "./use-report-analysis-summary";
import { useReportQaTranscripts } from "./use-report-qa-transcripts";
import { useReportPitchTranscript } from "./use-report-pitch-transcript";

type TrainingTranscript = {
  id: string;
  recordingId: string;
  sessionId: string;
  status: string;
  source: string;
  language: string;
  text: string;
  segmentsJson: string | null;
  errorMessage: string | null;
  startedAt: string | null;
  completedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

type TrainingRecording = {
  id: string;
  phase: string;
  playbackUrl: string;
  mimeType: string;
  sizeBytes: number;
  durationSec: number | null;
  transcript: TrainingTranscript | null;
};

type TrainingQaQuestion = {
  id: string;
  orderIndex: number;
  questionText: string;
  questionType: string | null;
  source: string;
  basis: string | null;
  answer: {
    id: string;
    answerText: string | null;
    revealedQuestionText: boolean;
    startedAt: string | null;
    endedAt: string | null;
    durationSec: number | null;
    recording: TrainingRecording | null;
  } | null;
};

function isDynamicFollowupQuestion(question: TrainingQaQuestion) {
  return (
    question.source === "DYNAMIC_FOLLOWUP" ||
    question.questionType === "FOLLOWUP"
  );
}

function hasEnteredQaQuestion(question: TrainingQaQuestion) {
  return Boolean(
    question.answer?.startedAt ||
      question.answer?.endedAt ||
      question.answer?.recording ||
      question.answer?.answerText?.trim(),
  );
}

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
  const [activeTab, setActiveTab] = useState<ReportTabKey>(
    isAborted ? "abort-overview" : "overview",
  );
  const contentRef = useRef<HTMLDivElement>(null);
  // 展开/收起：内容覆盖
  const [showAllCoverage, setShowAllCoverage] = useState(false);

  // 切换 Tab 时回到内容顶部
  useEffect(() => {
    const el = contentRef.current;

    if (el) {
      el.scrollIntoView({ block: "start" });
    }
  }, [activeTab]);

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
            onToggleTranscriptExpanded={() =>
              toggleTranscriptExpanded()
            }
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
          onToggleShowAllCoverage={() => setShowAllCoverage((p) => !p)}
          onStartTranscriptEditing={startTranscriptEditing}
          onToggleTranscriptExpanded={toggleTranscriptExpanded}
          onTranscriptDraftChange={setTranscriptDraft}
          onCancelTranscriptEditing={cancelTranscriptEditing}
          onSaveTranscript={() => void saveTranscript()}
        />
      )}

      {/* === 答辩表现 Tab === */}
      {activeTab === "qa" && (
        (() => {
          // 只展示用户实际进入过的题目。
          const baseQuestions = qaQuestions.filter(
            (q) => !isDynamicFollowupQuestion(q),
          );
          const enteredQuestions = baseQuestions.filter(hasEnteredQaQuestion);
          const dynamicFollowupQuestion =
            qaQuestions.find(
              (q) => isDynamicFollowupQuestion(q) && hasEnteredQaQuestion(q),
            ) ?? null;
          const dynamicFollowupReview =
            analysis?.dynamicFollowupReview ?? null;
          const skippedCount = baseQuestions.length - enteredQuestions.length;
          // QA 复盘也仅过滤已进入的题目
          const enteredQuestionIds = new Set(enteredQuestions.map((q) => q.id));
          const enteredQaReviews = (analysis?.qaReviews ?? []).filter(
            (r) => enteredQuestionIds.has(r.questionId),
          );

          return (
            <ReportQaTab
              enteredQuestions={enteredQuestions}
              dynamicFollowupQuestion={dynamicFollowupQuestion}
              dynamicFollowupReview={dynamicFollowupReview}
              enteredQaReviews={enteredQaReviews}
              skippedCount={skippedCount}
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
          );
        })())}
    </div>
    </div>
  );
}
