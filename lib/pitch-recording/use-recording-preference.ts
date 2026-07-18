"use client";

import { useEffect } from "react";
import type { RecordingResources } from "./use-recording-resources";
import type { RecordingState } from "./use-recording-state";
import type { TrainingRecording } from "./types";

type UseRecordingPreferenceOptions = {
  autoStartRecordingOnMount: boolean;
  initialRecording: TrainingRecording | null;
  isGuardResolved: boolean;
  isPitching: boolean;
  prepareAndStartRecordingAutomatically: () => Promise<void>;
  resources: RecordingResources;
  sessionId: string;
  state: RecordingState;
};

export function useRecordingPreference({
  autoStartRecordingOnMount,
  initialRecording,
  isGuardResolved,
  isPitching,
  prepareAndStartRecordingAutomatically,
  resources,
  sessionId,
  state,
}: UseRecordingPreferenceOptions) {
  const { hasHandledPitchRecordingPreferenceRef } = resources;
  const { setRecordingMessage, setRecordingStatus } = state;

  useEffect(() => {
    if (
      !autoStartRecordingOnMount ||
      !isPitching ||
      !isGuardResolved ||
      hasHandledPitchRecordingPreferenceRef.current ||
      initialRecording
    ) {
      return;
    }

    hasHandledPitchRecordingPreferenceRef.current = true;
    const preference =
      window.sessionStorage.getItem(
        `training:${sessionId}:recordingPreference`,
      ) ?? "skip";

    if (preference !== "record") {
      window.setTimeout(() => {
        setRecordingStatus("OPTED_OUT");
        setRecordingMessage("本轮未启用录音，仅记录翻页和用时。");
      }, 0);
      return;
    }

    void prepareAndStartRecordingAutomatically();
  }, [
    autoStartRecordingOnMount,
    hasHandledPitchRecordingPreferenceRef,
    initialRecording,
    isGuardResolved,
    isPitching,
    prepareAndStartRecordingAutomatically,
    sessionId,
    setRecordingMessage,
    setRecordingStatus,
  ]);
}
