"use client";

import { useCallback, useEffect } from "react";
import { devLog } from "@/lib/dev-log";
import { chooseJudgeVoice, isSpeechSynthesisSupported } from "./policy";
import { getVoicesWithRetry } from "./voice-selection";
import type { SpeechResources } from "./use-speech-resources";

type UseJudgeVoiceOptions = {
  resources: SpeechResources;
  sessionId: string;
  status: string;
};

export function useJudgeVoice({
  resources,
  sessionId,
  status,
}: UseJudgeVoiceOptions) {
  const { preferredJudgeVoiceRef } = resources;

  const prepareJudgeVoice = useCallback(async () => {
    if (!isSpeechSynthesisSupported()) {
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
  }, [preferredJudgeVoiceRef, sessionId]);

  useEffect(() => {
    if (status !== "QA_READY" && status !== "QAING") {
      return;
    }

    void prepareJudgeVoice();
  }, [prepareJudgeVoice, status]);
}
