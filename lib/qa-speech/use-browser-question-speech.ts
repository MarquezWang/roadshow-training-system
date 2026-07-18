"use client";

import { useCallback } from "react";
import { devLog } from "@/lib/dev-log";
import {
  chooseJudgeVoice,
  estimateQuestionSpeechMs,
  isSpeechSynthesisSupported,
  recoverableSpeechErrorCodes,
} from "./policy";
import type { QuestionSpeechRun } from "./types";
import type { SpeechResources } from "./use-speech-resources";
import { getVoicesWithRetry } from "./voice-selection";

type UseBrowserQuestionSpeechOptions = {
  resources: SpeechResources;
  sessionId: string;
  showQuestionTextFallback: (
    question: QuestionSpeechRun["question"],
    speechRunId: number,
    reason: string,
  ) => void;
};

export function useBrowserQuestionSpeech({
  resources,
  sessionId,
  showQuestionTextFallback,
}: UseBrowserQuestionSpeechOptions) {
  const {
    hasMoveOnRef,
    preferredJudgeVoiceRef,
    speechRunIdRef,
    speechTimeoutRef,
  } = resources;

  const fallbackToBrowserSpeech = useCallback(
    (run: QuestionSpeechRun) => {
      const {
        isCurrentSpeechRun,
        moveOn,
        question,
        speechRunId,
        speechStartedRef,
      } = run;

      if (!isSpeechSynthesisSupported()) {
        showQuestionTextFallback(question, speechRunId, "unsupported");
        return;
      }

      const speakBrowserQuestion = async (retryCount = 0) => {
        const utterance = new SpeechSynthesisUtterance(question.questionText);

        utterance.lang = "zh-CN";
        utterance.rate = 1.15;
        utterance.pitch = 0.92;
        utterance.onstart = () => {
          speechStartedRef.current = true;
        };
        utterance.onend = () => {
          if (!isCurrentSpeechRun()) {
            return;
          }

          moveOn();
        };
        utterance.onerror = (event) => {
          if (!isCurrentSpeechRun()) {
            return;
          }

          const errorCode = event.error;

          devLog("[QA TTS] 播报错误", {
            sessionId,
            questionId: question.id,
            errorCode,
            retryCount,
          });

          if (recoverableSpeechErrorCodes.has(errorCode) && retryCount < 1) {
            window.setTimeout(() => {
              if (!isCurrentSpeechRun()) {
                return;
              }

              void speakBrowserQuestion(retryCount + 1);
            }, 180);
            return;
          }

          showQuestionTextFallback(question, speechRunId, errorCode);
        };

        let selectedVoice = preferredJudgeVoiceRef.current;
        if (!selectedVoice) {
          const voices = await getVoicesWithRetry(3000);

          selectedVoice = chooseJudgeVoice(voices);
          preferredJudgeVoiceRef.current = selectedVoice;
        }

        if (!isCurrentSpeechRun()) {
          return;
        }

        if (selectedVoice) {
          utterance.voice = selectedVoice;
          utterance.lang = selectedVoice.lang;
          devLog(
            `[QA TTS] 选中语音：${selectedVoice.name} (${selectedVoice.lang})`,
          );
          try {
            localStorage.setItem("qa-preferred-voice", selectedVoice.name);
          } catch {
            // localStorage 不可用
          }
        } else {
          devLog("[QA TTS] 未获取到 voice，尝试使用浏览器默认语音", {
            sessionId,
            questionId: question.id,
          });
        }

        try {
          window.speechSynthesis.resume();
          window.speechSynthesis.speak(utterance);
        } catch (error) {
          if (!isCurrentSpeechRun()) {
            return;
          }

          devLog("[QA TTS] speak 调用失败", {
            sessionId,
            questionId: question.id,
            error: error instanceof Error ? error.message : String(error),
          });
          showQuestionTextFallback(question, speechRunId, "speak_failed");
        }
      };

      function scheduleBrowserFallback() {
        speechTimeoutRef.current = window.setTimeout(() => {
          if (
            hasMoveOnRef.current ||
            speechRunIdRef.current !== speechRunId
          ) {
            return;
          }
          if (window.speechSynthesis.speaking || window.speechSynthesis.pending) {
            scheduleBrowserFallback();
            return;
          }
          if (!speechStartedRef.current) {
            showQuestionTextFallback(
              question,
              speechRunId,
              "speech_not_started",
            );
            return;
          }
          moveOn();
        }, estimateQuestionSpeechMs(question.questionText));
      }

      void speakBrowserQuestion();
      scheduleBrowserFallback();
    },
    [
      hasMoveOnRef,
      preferredJudgeVoiceRef,
      sessionId,
      showQuestionTextFallback,
      speechRunIdRef,
      speechTimeoutRef,
    ],
  );

  return { fallbackToBrowserSpeech };
}
