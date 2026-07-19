"use client";

import { useCallback } from "react";
import { useRouter } from "next/navigation";
import type { DisplayMaterialNotice } from "@/lib/display-material";
import {
  useQaMaterialPreview,
  type QaPreviewFile,
} from "@/lib/use-qa-material-preview";
import { useQaPageGuards } from "@/lib/use-qa-page-guards";
import { useQaQuestionGeneration } from "@/lib/use-qa-question-generation";
import { useQaRecording } from "@/lib/use-qa-recording";
import { speechUnavailableMessage, useQaSpeech } from "@/lib/use-qa-speech";
import {
  findInitialQaQuestionIndex,
  getQaProgression,
  isDynamicFollowupQuestion,
} from "./training-qa/training-qa-flow";
import { getQaPhaseLabel } from "./training-qa/training-qa-format";
import { TrainingQaOverlays } from "./training-qa/training-qa-overlays";
import { TrainingQaStage } from "./training-qa/training-qa-stage";
import { getCurrentQuestionTiming } from "./training-qa/training-qa-timing";
import { useTrainingQaAnswerDuration } from "./training-qa/use-training-qa-answer-duration";
import { useTrainingQaAnswerTimer } from "./training-qa/use-training-qa-answer-timer";
import { useTrainingQaCountdown } from "./training-qa/use-training-qa-countdown";
import { useTrainingQaLifecycle } from "./training-qa/use-training-qa-lifecycle";
import { useTrainingQaPersistence } from "./training-qa/use-training-qa-persistence";
import { useTrainingQaQuestionFlow } from "./training-qa/use-training-qa-question-flow";
import { useTrainingQaStart } from "./training-qa/use-training-qa-start";
import { useTrainingQaState } from "./training-qa/use-training-qa-state";
import type { TrainingQaQuestion } from "./training-qa/training-qa-types";

type TrainingQaClientProps = Readonly<{
  sessionId: string;
  projectName: string;
  initialStatus: string;
  initialRemainingSec: number;
  initialQuestions: TrainingQaQuestion[];
  previewFile: QaPreviewFile | null;
  previewNotice: DisplayMaterialNotice | null;
  dynamicFollowupExperiment: boolean;
}>;

export function TrainingQaClient({
  sessionId,
  projectName,
  initialStatus,
  initialRemainingSec,
  initialQuestions,
  previewFile,
  previewNotice,
  dynamicFollowupExperiment,
}: TrainingQaClientProps) {
  const router = useRouter();
  const initialQuestionIndex = findInitialQaQuestionIndex(initialQuestions);
  const qaState = useTrainingQaState({
    initialQuestionIndex,
    initialQuestions,
    initialRemainingSec,
    initialStatus,
  });
  const {
    answerElapsedBeforePhaseRef,
    answerPhaseStartedMsRef,
    beginJudgeQuestionRef,
    beginPreAnswerCountdownRef,
    countdownIntervalRef,
    currentAnswerStartedAtRef,
    currentQuestionIndex,
    dynamicFollowupIntroQuestion,
    dynamicFollowupIntroShownQuestionIdsRef,
    dynamicFollowupIntroTimerRef,
    dynamicFollowupUsedSec,
    hasAutoEndedRef,
    hasResumedQaingRef,
    isCompletingNormallyRef,
    isSaving,
    isStarting,
    message,
    preAnswerOverlay,
    qaPhase,
    questions,
    revealedQuestionIds,
    setCurrentQuestionIndex,
    setDynamicFollowupIntroQuestion,
    setDynamicFollowupUsedSec,
    setIsSaving,
    setIsStarting,
    setMessage,
    setPreAnswerOverlay,
    setQaPhase,
    setQuestions,
    setRevealedQuestionIds,
    setStatus,
    setUsedAnswerSec,
    status,
    usedAnswerSec,
  } = qaState;
  const currentQuestion = questions[currentQuestionIndex] ?? null;
  const isQaing = status === "QAING";
  const isCurrentDynamicFollowup = isDynamicFollowupQuestion(currentQuestion);
  const { remainingSec } = getCurrentQuestionTiming(
    isCurrentDynamicFollowup,
    usedAnswerSec,
    dynamicFollowupUsedSec,
  );
  const {
    nextDynamicFollowupIndex,
    shouldSkipToDynamicFollowup,
    shouldFinishAfterCurrent,
  } = getQaProgression(questions, currentQuestionIndex, remainingSec);
  const {
    canvasRef,
    previewContainerRef,
    compatiblePreviewUrl,
    canGoPrev,
    canGoNext,
    pageLabel,
    isPdfLoading,
    pdfError,
    previewMode,
    setPreviewMode,
    changeMaterialPage,
  } = useQaMaterialPreview({ previewFile });
  const { isGuardResolved } = useQaPageGuards({
    sessionId,
    initialStatus,
    status,
    isCompletingNormallyRef,
  });

  const markQuestionTextRevealed = useCallback((questionId: string) => {
    setRevealedQuestionIds((current) => {
      const next = new Set(current);

      next.add(questionId);

      return next;
    });
  }, [setRevealedQuestionIds]);

  const {
    questionTextDialog,
    setQuestionTextDialog,
    clearSpeechTimer,
    cancelSpeech,
    confirmFallbackQuestionRead,
    startQuestionSpeech,
  } = useQaSpeech({
    sessionId,
    status,
    hasAutoEndedRef,
    beginPreAnswerCountdown: () => {
      beginPreAnswerCountdownRef.current?.();
    },
    onMessageChange: setMessage,
    onQuestionTextRevealed: markQuestionTextRevealed,
  });

  const {
    clearRecordingMessage,
    cleanupRecording,
    startQuestionRecording,
    stopAndUploadCurrentRecording,
  } = useQaRecording({ sessionId });

  const { isGenerating } = useQaQuestionGeneration({
    sessionId,
    dynamicFollowupExperiment,
    isGuardResolved,
    qaPhase,
    questions,
    setQuestions,
    setCurrentQuestionIndex,
    setMessage,
  });
  const { clearCountdownTimer } = useTrainingQaCountdown({
    answerElapsedBeforePhaseRef,
    answerPhaseStartedMsRef,
    beginPreAnswerCountdownRef,
    cancelSpeech,
    clearSpeechTimer,
    countdownIntervalRef,
    currentAnswerStartedAtRef,
    setDynamicFollowupUsedSec,
    setPreAnswerOverlay,
    setQaPhase,
    setUsedAnswerSec,
    startQuestionRecording,
    usedAnswerSec,
  });
  const { getCurrentUsedAnswerSec, getSessionQaDurationSec } =
    useTrainingQaAnswerDuration({
      answerElapsedBeforePhaseRef,
      answerPhaseStartedMsRef,
      currentQuestion,
      dynamicFollowupUsedSec,
      qaPhase,
      usedAnswerSec,
    });
  const {
    beginJudgeQuestion,
    clearDynamicFollowupIntroTimer,
    revealQuestionText,
  } = useTrainingQaQuestionFlow({
    beginJudgeQuestionRef,
    cancelSpeech,
    clearCountdownTimer,
    clearRecordingMessage,
    clearSpeechTimer,
    currentQuestion,
    dynamicFollowupIntroShownQuestionIdsRef,
    dynamicFollowupIntroTimerRef,
    markQuestionTextRevealed,
    questions,
    setCurrentQuestionIndex,
    setDynamicFollowupIntroQuestion,
    setMessage,
    setQaPhase,
    setQuestionTextDialog,
    startQuestionSpeech,
  });
  const navigateToReport = useCallback(
    () => router.push(`/training/${sessionId}/report`),
    [router, sessionId],
  );
  const { finishQaWithCurrentQuestion, saveAndContinue } =
    useTrainingQaPersistence({
      answerElapsedBeforePhaseRef,
      beginJudgeQuestion,
      cancelSpeech,
      clearCountdownTimer,
      clearSpeechTimer,
      currentAnswerStartedAtRef,
      currentQuestion,
      currentQuestionIndex,
      getCurrentUsedAnswerSec,
      getSessionQaDurationSec,
      hasAutoEndedRef,
      isCompletingNormallyRef,
      navigateToReport,
      qaPhase,
      questions,
      revealedQuestionIds,
      sessionId,
      setIsSaving,
      setMessage,
      setQaPhase,
      setQuestions,
      setUsedAnswerSec,
      shouldFinishAfterCurrent,
      stopAndUploadCurrentRecording,
    });
  const { startQa } = useTrainingQaStart({
    answerElapsedBeforePhaseRef,
    beginJudgeQuestion,
    hasAutoEndedRef,
    questions,
    sessionId,
    setIsStarting,
    setMessage,
    setStatus,
    setUsedAnswerSec,
  });

  useTrainingQaAnswerTimer({
    answerElapsedBeforePhaseRef,
    answerPhaseStartedMsRef,
    currentQuestion,
    finishQaWithCurrentQuestion,
    isQaing,
    nextDynamicFollowupIndex,
    qaPhase,
    saveAndContinue,
    setDynamicFollowupUsedSec,
    setUsedAnswerSec,
  });
  useTrainingQaLifecycle({
    beginJudgeQuestion,
    cancelSpeech,
    cleanupRecording,
    clearCountdownTimer,
    clearDynamicFollowupIntroTimer,
    clearSpeechTimer,
    hasResumedQaingRef,
    initialQuestionIndex,
    initialStatus,
    isGuardResolved,
    questionCount: questions.length,
  });

  const shouldShowMessageToast =
    Boolean(message) &&
    !questionTextDialog &&
    message !== "答辩问题已生成。开始前不会展示完整题目。" &&
    message !== "评委问题生成时间较长，请稍候……" &&
    message !== speechUnavailableMessage;

  const handleSaveAnswer = useCallback(
    () =>
      saveAndContinue(
        shouldSkipToDynamicFollowup
          ? {
              targetQuestionIndex: nextDynamicFollowupIndex,
              forceFinish: false,
            }
          : undefined,
      ),
    [nextDynamicFollowupIndex, saveAndContinue, shouldSkipToDynamicFollowup],
  );
  const phaseLabel = getQaPhaseLabel(qaPhase);
  const mainButtonLabel = shouldSkipToDynamicFollowup
    ? "进入动态追问"
    : shouldFinishAfterCurrent
      ? "完成答辩"
      : "回答完毕，进入下一题";
  const questionProgressLabel =
    questions.length > 0 && currentQuestion
      ? [currentQuestion.orderIndex, questions.length].join(" / ")
      : ["0", questions.length].join(" / ");

  return (
    <>
      <TrainingQaOverlays
        isGuardResolved={isGuardResolved}
        showDynamicFollowupIntro={Boolean(dynamicFollowupIntroQuestion)}
        questionTextDialog={questionTextDialog}
        preAnswerOverlay={preAnswerOverlay}
        isCurrentDynamicFollowup={isCurrentDynamicFollowup}
        shouldShowMessageToast={shouldShowMessageToast}
        message={message}
        onConfirmQuestionText={confirmFallbackQuestionRead}
      />
      <div className="grid h-[calc(100vh-1.5rem)] w-full gap-3 overflow-hidden bg-slate-950 text-white">
        <TrainingQaStage
          projectName={projectName}
          phaseLabel={phaseLabel}
          remainingSec={remainingSec}
          questionProgressLabel={questionProgressLabel}
          previewFile={previewFile}
          previewNotice={previewNotice}
          pageLabel={pageLabel}
          previewMode={previewMode}
          compatiblePreviewUrl={compatiblePreviewUrl}
          previewContainerRef={previewContainerRef}
          canvasRef={canvasRef}
          isPdfLoading={isPdfLoading}
          pdfError={pdfError}
          canGoPrev={canGoPrev}
          canGoNext={canGoNext}
          isGenerating={isGenerating}
          canStartQa={!isQaing && questions.length > 0}
          canSaveAnswer={isQaing && qaPhase === "ANSWERING"}
          hasCurrentQuestion={isQaing && Boolean(currentQuestion)}
          isStarting={isStarting}
          isSaving={isSaving}
          mainButtonLabel={mainButtonLabel}
          onPreviewModeChange={setPreviewMode}
          onStartQa={startQa}
          onSaveAnswer={handleSaveAnswer}
          onRevealQuestionText={revealQuestionText}
          onChangeMaterialPage={changeMaterialPage}
        />
      </div>
    </>
  );
}
