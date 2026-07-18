"use client";

import { useState } from "react";
import { useBrowserQuestionSpeech } from "./use-browser-question-speech";
import { useJudgeVoice } from "./use-judge-voice";
import { useQuestionDialog } from "./use-question-dialog";
import { useQuestionSpeechRun } from "./use-question-speech-run";
import { useSpeechControls } from "./use-speech-controls";
import { useSpeechResources } from "./use-speech-resources";
import { useTencentQuestionSpeech } from "./use-tencent-question-speech";
import type { QuestionTextDialog, UseQaSpeechOptions } from "./types";

export function useQaSpeech({
  sessionId,
  status,
  hasAutoEndedRef,
  beginPreAnswerCountdown,
  onMessageChange,
  onQuestionTextRevealed,
}: UseQaSpeechOptions) {
  const [questionTextDialog, setQuestionTextDialog] =
    useState<QuestionTextDialog>(null);
  const resources = useSpeechResources();
  const controls = useSpeechControls(resources);

  useJudgeVoice({ resources, sessionId, status });

  const dialog = useQuestionDialog({
    beginPreAnswerCountdown,
    clearSpeechTimer: controls.clearSpeechTimer,
    hasAutoEndedRef,
    onMessageChange,
    onQuestionTextRevealed,
    questionTextDialog,
    resources,
    sessionId,
    setQuestionTextDialog,
  });
  const browserSpeech = useBrowserQuestionSpeech({
    resources,
    sessionId,
    showQuestionTextFallback: dialog.showQuestionTextFallback,
  });
  const tencentSpeech = useTencentQuestionSpeech({
    fallbackToBrowserSpeech: browserSpeech.fallbackToBrowserSpeech,
    resources,
    sessionId,
    showQuestionTextFallback: dialog.showQuestionTextFallback,
    stopTencentAudio: controls.stopTencentAudio,
  });
  const speechRun = useQuestionSpeechRun({
    beginPreAnswerCountdown,
    fallbackToBrowserSpeech: browserSpeech.fallbackToBrowserSpeech,
    hasAutoEndedRef,
    playTencentQuestionSpeech: tencentSpeech.playTencentQuestionSpeech,
    resources,
    setQuestionTextDialog,
    showQuestionTextFallback: dialog.showQuestionTextFallback,
  });

  return {
    questionTextDialog,
    setQuestionTextDialog,
    clearSpeechTimer: controls.clearSpeechTimer,
    cancelSpeech: controls.cancelSpeech,
    confirmFallbackQuestionRead: dialog.confirmFallbackQuestionRead,
    startQuestionSpeech: speechRun.startQuestionSpeech,
  };
}
