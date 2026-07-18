"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  usePitchPdfPreview,
  type PreviewNotice,
  type TrainingFile,
} from "@/lib/use-pitch-pdf-preview";
import { useFullscreenMode } from "@/lib/use-fullscreen-mode";
import {
  usePitchRecording,
  type TrainingRecording,
} from "@/lib/use-pitch-recording";
import { usePitchTranscript } from "@/lib/use-pitch-transcript";
import {
  usePitchAnalysis,
  type TrainingAnalysis,
} from "@/lib/use-pitch-analysis";
import { TrainingPitchSidebar } from "./training-session/training-pitch-sidebar";
import { TrainingPitchStage } from "./training-session/training-pitch-stage";
import { TrainingRecordingDialogs } from "./training-session/training-recording-dialogs";
import { TrainingSessionOverlays } from "./training-session/training-session-overlays";
import {
  getRecordingStatusLabel,
  getTrainingStatusHint,
  getTrainingStatusLabel,
  isPitchEndedStatus,
} from "./training-session/training-session-policy";
import { useTrainingPitchEnd } from "./training-session/use-training-pitch-end";
import { useTrainingPitchKeyboardNavigation } from "./training-session/use-training-pitch-keyboard-navigation";
import { useTrainingPitchPageGuards } from "./training-session/use-training-pitch-page-guards";
import { useTrainingPitchQaPregeneration } from "./training-session/use-training-pitch-qa-pregeneration";
import { useTrainingPitchTimer } from "./training-session/use-training-pitch-timer";

type TrainingSessionClientProps = Readonly<{
  sessionId: string;
  projectName: string;
  initialStatus: string;
  initialPageIndex: number;
  initialPitchStartedAt: string | null;
  initialElapsedSec: number;
  initialRemainingSec: number;
  initialPitchDurationSec: number | null;
  previewFile: TrainingFile | null;
  previewNotice: PreviewNotice | null;
  initialRecording: TrainingRecording | null;
  initialAnalysis: TrainingAnalysis | null;
  autoStartRecordingOnMount?: boolean;
  redirectToQaAfterPitchEnd?: boolean;
  showAnalysisPanel?: boolean;
}>;

export function TrainingSessionClient({
  sessionId,
  projectName,
  initialStatus,
  initialPageIndex,
  initialPitchStartedAt,
  initialElapsedSec,
  initialRemainingSec,
  initialPitchDurationSec,
  previewFile,
  previewNotice,
  initialRecording,
  initialAnalysis,
  autoStartRecordingOnMount = false,
  redirectToQaAfterPitchEnd = false,
  showAnalysisPanel = true,
}: TrainingSessionClientProps) {
  const [status, setStatus] = useState(initialStatus);
  const [pageIndex, setPageIndex] = useState(initialPageIndex);
  const [pitchStartedAt] = useState(initialPitchStartedAt);
  const [elapsedSec, setElapsedSec] = useState(
    initialPitchDurationSec ?? initialElapsedSec,
  );
  const [remainingSec, setRemainingSec] = useState(initialRemainingSec);
  const [message, setMessage] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const hasAutoEndedPitchRef = useRef(false);
  const isCompletingNormallyRef = useRef(false);
  const isPitching = status === "PITCHING";
  const isEnded = isPitchEndedStatus(status);
  const { isGuardResolved } = useTrainingPitchPageGuards({
    initialStatus,
    isCompletingNormallyRef,
    isPitching,
    sessionId,
  });
  const {
    transcript,
    transcriptDraft,
    setTranscriptDraft,
    isTranscriptEditing,
    isTranscriptSaving,
    transcriptMessage,
    transcribeStatus,
    transcribeErrorMessage,
    saveTranscript,
    startTranscriptEditing,
    cancelTranscriptEditing,
    triggerTranscribe,
    resetTranscriptAfterRecordingSaved,
  } = usePitchTranscript({
    sessionId,
    recordingId: initialRecording?.id ?? "",
    initialTranscript: initialRecording?.transcript ?? null,
  });
  const { analysis, isAnalysisLoading, analysisMessage, generateAnalysis } =
    usePitchAnalysis({
      sessionId,
      isEnded,
      transcript,
      transcribeStatus,
      initialAnalysis,
    });
  const {
    recordingStatus,
    recordingMessage,
    recordingId,
    recordingPlaybackUrl,
    showRecordingPrepDialog,
    showRecordingOptOutConfirm,
    showRecordingReenableConfirm,
    prepareRecording,
    confirmRecordingOptOut,
    stopRecordingAndUpload,
    isRecordingActive,
    openRecordingOptOutConfirm,
    closeRecordingOptOutConfirm,
    openRecordingReenableConfirm,
    closeRecordingReenableConfirm,
    reenableRecording,
    handlePitchEndedWithoutRecording,
    markTranscribePreparing,
  } = usePitchRecording({
    sessionId,
    initialStatus,
    initialRecording,
    autoStartRecordingOnMount,
    isPitching,
    isGuardResolved,
    onRecordingSaved: resetTranscriptAfterRecordingSaved,
  });
  const requestPdfRenderRef = useRef<() => void>(() => {});
  const handleFullscreenLayoutChanged = useCallback(() => {
    requestPdfRenderRef.current();
  }, []);
  const {
    containerRef: trainingShellRef,
    isBigScreenMode,
    fullscreenMessage,
  } = useFullscreenMode({
    initialBigScreenMode: initialStatus === "PITCHING",
    onLayoutChanged: handleFullscreenLayoutChanged,
  });
  const handlePdfDocumentLoaded = useCallback((loadedTotalPages: number) => {
    setPageIndex((currentIndex) =>
      Math.min(Math.max(currentIndex, 0), loadedTotalPages - 1),
    );
  }, []);
  const handlePdfPageChange = useCallback((nextPageIndex: number) => {
    setPageIndex(nextPageIndex);
  }, []);
  const handlePdfSubmittingChange = useCallback((submitting: boolean) => {
    setIsSubmitting(submitting);
  }, []);
  const handlePdfPageChangeStart = useCallback(() => {
    setMessage("");
  }, []);
  const handlePdfError = useCallback((errorMessage: string) => {
    setMessage(errorMessage);
  }, []);
  const {
    canvasRef,
    previewContainerRef,
    compatiblePreviewUrl,
    primaryFileId,
    currentPageNumber,
    pageLabel,
    canGoPrev,
    canGoNext,
    pdfError,
    isPdfLoading,
    previewMode,
    setPreviewMode,
    changePage,
    requestRender: requestPdfRender,
  } = usePitchPdfPreview({
    sessionId,
    previewFile,
    pageIndex,
    elapsedSec,
    isPitching,
    isSubmitting,
    isBigScreenMode,
    onDocumentLoaded: handlePdfDocumentLoaded,
    onPageChange: handlePdfPageChange,
    onSubmittingChange: handlePdfSubmittingChange,
    onPageChangeStart: handlePdfPageChangeStart,
    onError: handlePdfError,
  });
  useEffect(() => {
    requestPdfRenderRef.current = requestPdfRender;
  }, [requestPdfRender]);
  useTrainingPitchTimer({
    isGuardResolved,
    isPitching,
    pitchStartedAt,
    setElapsedSec,
    setRemainingSec,
  });
  useTrainingPitchQaPregeneration({
    isGuardResolved,
    isPitching,
    sessionId,
  });
  useTrainingPitchKeyboardNavigation({ changePage });
  const statusLabel = getTrainingStatusLabel(status);
  const statusHint = getTrainingStatusHint(status);
  const recordingStatusLabel = getRecordingStatusLabel(recordingStatus);
  const { endPitch } = useTrainingPitchEnd({
    currentPageNumber,
    elapsedSec,
    handlePitchEndedWithoutRecording,
    hasAutoEndedPitchRef,
    isCompletingNormallyRef,
    isPitching,
    isRecordingActive,
    markTranscribePreparing,
    primaryFileId,
    redirectToQaAfterPitchEnd,
    remainingSec,
    sessionId,
    setElapsedSec,
    setIsSubmitting,
    setMessage,
    setPageIndex,
    setRemainingSec,
    setStatus,
    stopRecordingAndUpload,
    triggerTranscribe,
  });

  const shellClassName = isBigScreenMode
    ? "fixed inset-0 z-50 grid h-screen w-screen gap-3 overflow-hidden bg-slate-950 p-3 text-white"
    : "grid gap-5 lg:grid-cols-[minmax(0,1fr)_320px]";

  return (
    <>
      <TrainingSessionOverlays
        isGuardResolved={isGuardResolved}
      />
      <div ref={trainingShellRef} className={shellClassName}>
        <TrainingPitchStage
          projectName={projectName}
          status={status}
          statusLabel={statusLabel}
          statusHint={statusHint}
          recordingStatus={recordingStatus}
          recordingStatusLabel={recordingStatusLabel}
          remainingSec={remainingSec}
          pageLabel={pageLabel}
          message={message}
          fullscreenMessage={fullscreenMessage}
          previewFile={previewFile}
          previewNotice={previewNotice}
          compatiblePreviewUrl={compatiblePreviewUrl}
          previewMode={previewMode}
          previewContainerRef={previewContainerRef}
          canvasRef={canvasRef}
          isPdfLoading={isPdfLoading}
          pdfError={pdfError}
          currentPageNumber={currentPageNumber}
          isBigScreenMode={isBigScreenMode}
          isSubmitting={isSubmitting}
          isPitching={isPitching}
          canGoPrev={canGoPrev}
          canGoNext={canGoNext}
          onPreviewModeChange={setPreviewMode}
          onOpenRecordingReenableConfirm={openRecordingReenableConfirm}
          onPrepareRecording={prepareRecording}
          onEndPitch={endPitch}
          onChangePage={changePage}
        />

        {!isBigScreenMode ? (
          <TrainingPitchSidebar
            elapsedSec={elapsedSec}
            pageLabel={pageLabel}
            recordingStatus={recordingStatus}
            recordingStatusLabel={recordingStatusLabel}
            recordingMessage={recordingMessage}
            recordingPlaybackUrl={recordingPlaybackUrl}
            recordingId={recordingId}
            isEnded={isEnded}
            transcript={transcript}
            transcriptDraft={transcriptDraft}
            isTranscriptEditing={isTranscriptEditing}
            isTranscriptSaving={isTranscriptSaving}
            transcriptMessage={transcriptMessage}
            transcribeStatus={transcribeStatus}
            transcribeErrorMessage={transcribeErrorMessage}
            showAnalysisPanel={showAnalysisPanel}
            analysis={analysis}
            analysisMessage={analysisMessage}
            isAnalysisLoading={isAnalysisLoading}
            onRetryTranscribe={triggerTranscribe}
            onStartTranscriptEditing={startTranscriptEditing}
            onCancelTranscriptEditing={cancelTranscriptEditing}
            onTranscriptDraftChange={setTranscriptDraft}
            onSaveTranscript={saveTranscript}
            onGenerateAnalysis={generateAnalysis}
          />
        ) : null}

        <TrainingRecordingDialogs
          status={status}
          recordingMessage={recordingMessage}
          showRecordingPrepDialog={showRecordingPrepDialog}
          showRecordingOptOutConfirm={showRecordingOptOutConfirm}
          showRecordingReenableConfirm={showRecordingReenableConfirm}
          onOpenRecordingOptOutConfirm={openRecordingOptOutConfirm}
          onCloseRecordingOptOutConfirm={closeRecordingOptOutConfirm}
          onConfirmRecordingOptOut={confirmRecordingOptOut}
          onPrepareRecording={prepareRecording}
          onCloseRecordingReenableConfirm={closeRecordingReenableConfirm}
          onReenableRecording={reenableRecording}
        />
      </div>
    </>
  );
}
