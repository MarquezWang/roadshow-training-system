"use client";

import { useCallback } from "react";
import type { SpeechResources } from "./use-speech-resources";

export function useSpeechControls(resources: SpeechResources) {
  const { activeAudioRef, activeAudioUrlRef, speechTimeoutRef } = resources;

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
  }, [activeAudioRef, activeAudioUrlRef]);

  const clearSpeechTimer = useCallback(() => {
    if (speechTimeoutRef.current !== null) {
      window.clearTimeout(speechTimeoutRef.current);
      speechTimeoutRef.current = null;
    }
  }, [speechTimeoutRef]);

  const cancelSpeech = useCallback(() => {
    stopTencentAudio();
    window.speechSynthesis?.cancel();
  }, [stopTencentAudio]);

  return {
    cancelSpeech,
    clearSpeechTimer,
    stopTencentAudio,
  };
}
