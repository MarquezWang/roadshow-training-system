"use client";

import {
  type Dispatch,
  type MutableRefObject,
  type SetStateAction,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import { devLog } from "@/lib/dev-log";

export type QaSpeechQuestion = {
  id: string;
  orderIndex: number;
  questionText: string;
  questionType: string | null;
  source: string;
  basis: string | null;
};

export type QuestionTextDialog =
  | {
      question: QaSpeechQuestion;
      mode: "reading" | "fallback" | "review";
    }
  | null;

export const speechUnavailableMessage =
  "题目语音播报暂不可用，已切换为文字提问。你的回答录音不受影响。";

const recoverableSpeechErrorCodes = new Set(["canceled", "interrupted"]);
const tencentQuestionAudioPlaybackRate = 1.1;

function estimateQuestionSpeechMs(text: string) {
  const chineseCharCount = Array.from(text.trim()).length;

  return Math.min(28000, Math.max(5000, chineseCharCount * 170));
}

function chooseJudgeVoice(voices: SpeechSynthesisVoice[]) {
  if (voices.length === 0) return null;

  const normalizedVoices = voices.map((voice) => ({
    voice,
    name: voice.name.toLowerCase(),
    lang: voice.lang.toLowerCase(),
  }));

  const isHuihui = ({ name }: { name: string }) =>
    name.includes("huihui") || name.includes("慧慧");
  const preferredNameKeywords = [
    "xiaoyi",
    "晓伊",
    "yunyang",
    "云扬",
    "xiaoxiao",
    "晓晓",
    "yunxi",
    "云希",
    "natural",
    "自然",
  ];

  const findByName = (
    keywords: string[],
    predicate?: (voice: { lang: string; name: string }) => boolean,
  ) => {
    const normalizedKeywords = keywords.map((keyword) => keyword.toLowerCase());

    return normalizedVoices.find(
      ({ name, lang }) =>
        (!predicate || predicate({ lang, name })) &&
        normalizedKeywords.some((keyword) => name.includes(keyword)),
    )?.voice;
  };

  const zhCNVoices = normalizedVoices.filter(({ lang }) => lang === "zh-cn");
  const zhVoices = normalizedVoices.filter(({ lang }) => lang.startsWith("zh-"));
  const nonHuihuiZhCNVoices = zhCNVoices.filter((voice) => !isHuihui(voice));
  const nonHuihuiZhVoices = zhVoices.filter((voice) => !isHuihui(voice));

  return (
    findByName(preferredNameKeywords, ({ lang }) => lang === "zh-cn") ??
    nonHuihuiZhCNVoices.find(({ voice }) => voice.default)?.voice ??
    nonHuihuiZhCNVoices[0]?.voice ??
    findByName(preferredNameKeywords, ({ lang }) => lang.startsWith("zh-")) ??
    nonHuihuiZhVoices.find(({ voice }) => voice.default)?.voice ??
    nonHuihuiZhVoices[0]?.voice ??
    findByName(preferredNameKeywords) ??
    findByName(["huihui", "慧慧"]) ??
    voices.find((voice) => voice.default) ??
    voices[0] ??
    null
  );
}

function getVoicesAfterChange(timeoutMs: number) {
  return new Promise<SpeechSynthesisVoice[]>((resolve) => {
    const timeout = window.setTimeout(() => {
      window.speechSynthesis.removeEventListener("voiceschanged", handler);
      resolve(window.speechSynthesis.getVoices());
    }, timeoutMs);

    function handler() {
      window.clearTimeout(timeout);
      resolve(window.speechSynthesis.getVoices());
    }

    window.speechSynthesis.addEventListener("voiceschanged", handler, {
      once: true,
    });
  });
}

async function getVoicesWithRetry(timeoutMs = 3000) {
  const startedAt = Date.now();
  let voices = window.speechSynthesis.getVoices();

  if (voices.length > 0) {
    return voices;
  }

  voices = await getVoicesAfterChange(Math.min(1200, timeoutMs));

  while (voices.length === 0 && Date.now() - startedAt < timeoutMs) {
    await new Promise((resolve) => window.setTimeout(resolve, 250));
    voices = window.speechSynthesis.getVoices();
  }

  return voices;
}

function buildMoveOn(
  hasMovedOnRef: { current: boolean },
  beginPreAnswerCountdown: () => void,
) {
  return () => {
    if (hasMovedOnRef.current) {
      return;
    }
    hasMovedOnRef.current = true;
    beginPreAnswerCountdown();
  };
}

type UseQaSpeechOptions = {
  sessionId: string;
  status: string;
  hasAutoEndedRef: MutableRefObject<boolean>;
  beginPreAnswerCountdown: () => void;
  onMessageChange: Dispatch<SetStateAction<string>>;
  onQuestionTextRevealed: (questionId: string) => void;
};

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
  const speechTimeoutRef = useRef<number | null>(null);
  const speechRunIdRef = useRef(0);
  const preferredJudgeVoiceRef = useRef<SpeechSynthesisVoice | null>(null);
  const hasMoveOnRef = useRef(false);
  const activeAudioRef = useRef<HTMLAudioElement | null>(null);
  const activeAudioUrlRef = useRef<string | null>(null);

  const stopTencentAudio = useCallback(() => {
    const audio = activeAudioRef.current;

    if (audio) {
      audio.pause();
      audio.removeAttribute("src");
      audio.load();
      activeAudioRef.current = null;
    }

    if (activeAudioUrlRef.current) {
      URL.revokeObjectURL(activeAudioUrlRef.current);
      activeAudioUrlRef.current = null;
    }
  }, []);

  const clearSpeechTimer = useCallback(() => {
    if (speechTimeoutRef.current !== null) {
      window.clearTimeout(speechTimeoutRef.current);
      speechTimeoutRef.current = null;
    }
  }, []);

  const cancelSpeech = useCallback(() => {
    stopTencentAudio();
    window.speechSynthesis?.cancel();
  }, [stopTencentAudio]);

  const prepareJudgeVoice = useCallback(async () => {
    if (
      typeof window === "undefined" ||
      !("speechSynthesis" in window) ||
      typeof SpeechSynthesisUtterance === "undefined"
    ) {
      preferredJudgeVoiceRef.current = null;
      return null;
    }

    const voices = await getVoicesWithRetry(3000);
    const selectedVoice = chooseJudgeVoice(voices);

    preferredJudgeVoiceRef.current = selectedVoice;
    if (selectedVoice) {
      devLog(
        `[QA TTS] 预选语音：${selectedVoice.name} (${selectedVoice.lang})`,
      );
    } else {
      devLog("[QA TTS] 未找到可预选语音，将尝试浏览器默认语音", {
        sessionId,
      });
    }

    return selectedVoice;
  }, [sessionId]);

  useEffect(() => {
    if (status !== "QA_READY" && status !== "QAING") {
      return;
    }

    void prepareJudgeVoice();
  }, [prepareJudgeVoice, status]);

  const showQuestionTextFallback = useCallback(
    (question: QaSpeechQuestion, speechRunId: number, reason: string) => {
      if (speechRunIdRef.current !== speechRunId || hasAutoEndedRef.current) {
        return;
      }

      clearSpeechTimer();
      hasMoveOnRef.current = true;
      onQuestionTextRevealed(question.id);
      setQuestionTextDialog({
        question,
        mode: "fallback",
      });
      onMessageChange(speechUnavailableMessage);
      devLog("[QA TTS] 切换为文字提问", {
        sessionId,
        questionId: question.id,
        reason,
      });
    },
    [
      clearSpeechTimer,
      hasAutoEndedRef,
      onMessageChange,
      onQuestionTextRevealed,
      sessionId,
    ],
  );

  const confirmFallbackQuestionRead = useCallback(() => {
    if (!questionTextDialog || hasAutoEndedRef.current) {
      setQuestionTextDialog(null);
      return;
    }

    if (questionTextDialog.mode === "review") {
      setQuestionTextDialog(null);
      return;
    }

    setQuestionTextDialog(null);
    onMessageChange("");
    beginPreAnswerCountdown();
  }, [
    beginPreAnswerCountdown,
    hasAutoEndedRef,
    onMessageChange,
    questionTextDialog,
  ]);

  const startQuestionSpeech = useCallback(
    (question: QaSpeechQuestion) => {
      const speechRunId = speechRunIdRef.current + 1;
      speechRunIdRef.current = speechRunId;
      hasMoveOnRef.current = false;
      setQuestionTextDialog({
        question,
        mode: "reading",
      });

      if (
        typeof window === "undefined" ||
        !("speechSynthesis" in window) ||
        typeof SpeechSynthesisUtterance === "undefined"
      ) {
        showQuestionTextFallback(question, speechRunId, "unsupported");
        return;
      }

      const moveOn = buildMoveOn(hasMoveOnRef, () => {
        setQuestionTextDialog(null);
        beginPreAnswerCountdown();
      });
      const isCurrentSpeechRun = () =>
        speechRunIdRef.current === speechRunId && !hasAutoEndedRef.current;
      const speechStartedRef = { current: false };
      const playTencentQuestionSpeech = async () => {
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
            void speakBrowserQuestion();
            scheduleBrowserFallback();
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
      };

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

          if (errorCode === "not-allowed") {
            showQuestionTextFallback(question, speechRunId, errorCode);
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
          devLog(`[QA TTS] 选中语音：${selectedVoice.name} (${selectedVoice.lang})`);
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
          if (hasMoveOnRef.current || speechRunIdRef.current !== speechRunId) {
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

      function fallbackToBrowserSpeech() {
        if (
          typeof window === "undefined" ||
          !("speechSynthesis" in window) ||
          typeof SpeechSynthesisUtterance === "undefined"
        ) {
          showQuestionTextFallback(question, speechRunId, "unsupported");
          return;
        }

        void speakBrowserQuestion();
        scheduleBrowserFallback();
      }

      void playTencentQuestionSpeech().then((played) => {
        if (!played && isCurrentSpeechRun()) {
          fallbackToBrowserSpeech();
        }
      });
    },
    [
      beginPreAnswerCountdown,
      hasAutoEndedRef,
      sessionId,
      showQuestionTextFallback,
      stopTencentAudio,
    ],
  );

  return {
    questionTextDialog,
    setQuestionTextDialog,
    clearSpeechTimer,
    cancelSpeech,
    confirmFallbackQuestionRead,
    startQuestionSpeech,
  };
}
