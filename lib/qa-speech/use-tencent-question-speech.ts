"use client";

import { useCallback } from "react";
import { devLog } from "@/lib/dev-log";
import {
  estimateQuestionSpeechMs,
  tencentQuestionAudioPlaybackRate,
} from "./policy";
import type { QuestionSpeechRun } from "./types";
import type { SpeechResources } from "./use-speech-resources";

type UseTencentQuestionSpeechOptions = {
  fallbackToBrowserSpeech: (run: QuestionSpeechRun) => void;
  resources: SpeechResources;
  sessionId: string;
  showQuestionTextFallback: (
    question: QuestionSpeechRun["question"],
    speechRunId: number,
    reason: string,
  ) => void;
  stopTencentAudio: () => void;
};

export function useTencentQuestionSpeech({
  fallbackToBrowserSpeech,
  resources,
  sessionId,
  showQuestionTextFallback,
  stopTencentAudio,
}: UseTencentQuestionSpeechOptions) {
  const {
    activeAudioRef,
    activeAudioUrlRef,
    hasMoveOnRef,
    speechRunIdRef,
    speechTimeoutRef,
  } = resources;

  const playTencentQuestionSpeech = useCallback(
    async (run: QuestionSpeechRun) => {
      const { isCurrentSpeechRun, moveOn, question, speechRunId } = run;

      try {
        const response = await fetch(
          `/training/${sessionId}/qa/questions/${question.id}/tts`,
        );

        if (!response.ok) {
          return false;
        }

        const blob = await response.blob();

        if (!isCurrentSpeechRun()) {
          return true;
        }

        stopTencentAudio();
        const audioUrl = URL.createObjectURL(blob);
        const audio = new Audio(audioUrl);

        audio.playbackRate = tencentQuestionAudioPlaybackRate;
        activeAudioRef.current = audio;
        activeAudioUrlRef.current = audioUrl;
        audio.onended = () => {
          if (!isCurrentSpeechRun()) {
            return;
          }

          stopTencentAudio();
          moveOn();
        };
        audio.onerror = () => {
          if (!isCurrentSpeechRun()) {
            return;
          }

          stopTencentAudio();
          devLog("[QA TTS] 腾讯云音频播放失败，回退浏览器语音", {
            sessionId,
            questionId: question.id,
          });
          fallbackToBrowserSpeech(run);
        };
        speechTimeoutRef.current = window.setTimeout(() => {
          if (
            hasMoveOnRef.current ||
            speechRunIdRef.current !== speechRunId
          ) {
            return;
          }

          stopTencentAudio();
          showQuestionTextFallback(
            question,
            speechRunId,
            "tencent_audio_timeout",
          );
        }, estimateQuestionSpeechMs(question.questionText) + 8000);
        await audio.play();
        devLog("[QA TTS] 腾讯云语音开始播放", {
          sessionId,
          questionId: question.id,
        });

        return true;
      } catch (error) {
        if (isCurrentSpeechRun()) {
          devLog("[QA TTS] 腾讯云语音不可用，回退浏览器语音", {
            sessionId,
            questionId: question.id,
            error: error instanceof Error ? error.message : String(error),
          });
        }

        stopTencentAudio();
        return false;
      }
    },
    [
      activeAudioRef,
      activeAudioUrlRef,
      fallbackToBrowserSpeech,
      hasMoveOnRef,
      sessionId,
      showQuestionTextFallback,
      speechRunIdRef,
      speechTimeoutRef,
      stopTencentAudio,
    ],
  );

  return { playTencentQuestionSpeech };
}
