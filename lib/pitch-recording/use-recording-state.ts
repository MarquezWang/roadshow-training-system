"use client";

import { useState } from "react";
import type { RecordingStatus, TrainingRecording } from "./types";

export function useRecordingState(
  initialStatus: string,
  initialRecording: TrainingRecording | null,
) {
  const [recordingStatus, setRecordingStatus] = useState<RecordingStatus>(
    initialRecording ? "SAVED" : "UNDECIDED",
  );
  const [recordingMessage, setRecordingMessage] = useState(
    initialRecording ? "录音已保存。" : "",
  );
  const [recordingId, setRecordingId] = useState(initialRecording?.id ?? "");
  const [recordingPlaybackUrl, setRecordingPlaybackUrl] = useState(
    initialRecording?.playbackUrl ?? "",
  );
  const [showRecordingPrepDialog, setShowRecordingPrepDialog] = useState(
    initialStatus === "CREATED",
  );
  const [showRecordingOptOutConfirm, setShowRecordingOptOutConfirm] =
    useState(false);
  const [showRecordingReenableConfirm, setShowRecordingReenableConfirm] =
    useState(false);

  return {
    recordingStatus,
    setRecordingStatus,
    recordingMessage,
    setRecordingMessage,
    recordingId,
    setRecordingId,
    recordingPlaybackUrl,
    setRecordingPlaybackUrl,
    showRecordingPrepDialog,
    setShowRecordingPrepDialog,
    showRecordingOptOutConfirm,
    setShowRecordingOptOutConfirm,
    showRecordingReenableConfirm,
    setShowRecordingReenableConfirm,
  };
}

export type RecordingState = ReturnType<typeof useRecordingState>;
