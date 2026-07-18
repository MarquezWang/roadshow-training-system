"use client";

import { useRef } from "react";

export function useSpeechResources() {
  const speechTimeoutRef = useRef<number | null>(null);
  const speechRunIdRef = useRef(0);
  const preferredJudgeVoiceRef = useRef<SpeechSynthesisVoice | null>(null);
  const hasMoveOnRef = useRef(false);
  const activeAudioRef = useRef<HTMLAudioElement | null>(null);
  const activeAudioUrlRef = useRef<string | null>(null);

  return {
    activeAudioRef,
    activeAudioUrlRef,
    hasMoveOnRef,
    preferredJudgeVoiceRef,
    speechRunIdRef,
    speechTimeoutRef,
  };
}

export type SpeechResources = ReturnType<typeof useSpeechResources>;
