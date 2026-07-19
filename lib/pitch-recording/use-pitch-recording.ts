"use client";

import { useCallback, useEffect } from "react";
import { useRecordingMedia } from "./use-recording-media";
import { useRecordingPreference } from "./use-recording-preference";
import { useRecordingResources } from "./use-recording-resources";
import { useRecordingState } from "./use-recording-state";
import { useRecordingUpload } from "./use-recording-upload";
import type { UsePitchRecordingOptions } from "./types";

export function usePitchRecording({
  sessionId,
  initialStatus,
  initialRecording,
  autoStartRecordingOnMount,
  isPitching,
  isGuardResolved,
  onRecordingSaved,
}: UsePitchRecordingOptions) {
  const state = useRecordingState(initialStatus, initialRecording);
  const resources = useRecordingResources();
  const upload = useRecordingUpload({
    sessionId,
    onRecordingSaved,
    resources,
    state,
  });
  const media = useRecordingMedia({
    resources,
    state,
    ...upload,
  });
  const {
    recordingId,
    recordingMessage,
    recordingPlaybackUrl,
    recordingStatus,
    setRecordingMessage,
    setRecordingStatus,
    setShowRecordingOptOutConfirm,
    setShowRecordingPrepDialog,
    setShowRecordingReenableConfirm,
    showRecordingOptOutConfirm,
    showRecordingPrepDialog,
    showRecordingReenableConfirm,
  } = state;
  const {
    cleanupRecording,
    confirmRecordingOptOut,
    isRecordingActive,
    prepareAndStartRecordingAutomatically,
    prepareRecording,
    startRecording,
    stopMediaStream,
    stopRecordingAndUpload,
  } = media;

  useRecordingPreference({
    autoStartRecordingOnMount,
    initialRecording,
    isGuardResolved,
    isPitching,
    prepareAndStartRecordingAutomatically,
    resources,
    sessionId,
    state,
  });

  const openRecordingPrepDialog = useCallback(() => {
    setShowRecordingPrepDialog(true);
    setShowRecordingOptOutConfirm(false);
  }, [setShowRecordingOptOutConfirm, setShowRecordingPrepDialog]);

  const openRecordingOptOutConfirm = useCallback(() => {
    setShowRecordingOptOutConfirm(true);
  }, [setShowRecordingOptOutConfirm]);

  const closeRecordingOptOutConfirm = useCallback(() => {
    setShowRecordingOptOutConfirm(false);
  }, [setShowRecordingOptOutConfirm]);

  const openRecordingReenableConfirm = useCallback(() => {
    setShowRecordingReenableConfirm(true);
  }, [setShowRecordingReenableConfirm]);

  const closeRecordingReenableConfirm = useCallback(() => {
    setShowRecordingReenableConfirm(false);
  }, [setShowRecordingReenableConfirm]);

  const reenableRecording = useCallback(() => {
    setShowRecordingReenableConfirm(false);
    void prepareRecording();
  }, [prepareRecording, setShowRecordingReenableConfirm]);

  const handlePitchStartedRecording = useCallback(() => {
    if (recordingStatus === "READY_TO_RECORD") {
      void startRecording();
    } else if (recordingStatus === "OPTED_OUT") {
      setRecordingMessage("未启用录音，仅记录路演操作。");
    } else if (recordingStatus === "PERMISSION_DENIED") {
      setRecordingMessage(
        "麦克风权限未开启，本次可继续训练，但不会保存录音。",
      );
    } else if (recordingStatus === "UNSUPPORTED") {
      setRecordingMessage("当前浏览器不支持录音，本次仅记录路演操作。");
    }
  }, [recordingStatus, setRecordingMessage, startRecording]);

  const handlePitchEndedWithoutRecording = useCallback(() => {
    stopMediaStream();
    setRecordingStatus((currentStatus) =>
      currentStatus === "OPTED_OUT" ||
      currentStatus === "PERMISSION_DENIED" ||
      currentStatus === "UNSUPPORTED"
        ? currentStatus
        : "UNDECIDED",
    );
    setRecordingMessage("本次未启用录音。");
  }, [setRecordingMessage, setRecordingStatus, stopMediaStream]);

  const markTranscribePreparing = useCallback(() => {
    setRecordingMessage("路演录音已保存，系统正在准备转写。");
  }, [setRecordingMessage]);

  useEffect(() => {
    return cleanupRecording;
  }, [cleanupRecording]);

  return {
    recordingStatus,
    recordingMessage,
    recordingId,
    recordingPlaybackUrl,
    showRecordingPrepDialog,
    showRecordingOptOutConfirm,
    showRecordingReenableConfirm,
    prepareRecording,
    confirmRecordingOptOut,
    uploadRecording: upload.uploadRecording,
    startRecording,
    stopRecordingAndUpload,
    stopMediaStream,
    isRecordingActive,
    openRecordingPrepDialog,
    openRecordingOptOutConfirm,
    closeRecordingOptOutConfirm,
    openRecordingReenableConfirm,
    closeRecordingReenableConfirm,
    reenableRecording,
    handlePitchStartedRecording,
    handlePitchEndedWithoutRecording,
    markTranscribePreparing,
  };
}
