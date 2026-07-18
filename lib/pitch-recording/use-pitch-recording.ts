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

  useRecordingPreference({
    autoStartRecordingOnMount,
    initialRecording,
    isGuardResolved,
    isPitching,
    prepareAndStartRecordingAutomatically:
      media.prepareAndStartRecordingAutomatically,
    resources,
    sessionId,
    state,
  });

  const openRecordingPrepDialog = useCallback(() => {
    state.setShowRecordingPrepDialog(true);
    state.setShowRecordingOptOutConfirm(false);
  }, [state.setShowRecordingOptOutConfirm, state.setShowRecordingPrepDialog]);

  const openRecordingOptOutConfirm = useCallback(() => {
    state.setShowRecordingOptOutConfirm(true);
  }, [state.setShowRecordingOptOutConfirm]);

  const closeRecordingOptOutConfirm = useCallback(() => {
    state.setShowRecordingOptOutConfirm(false);
  }, [state.setShowRecordingOptOutConfirm]);

  const openRecordingReenableConfirm = useCallback(() => {
    state.setShowRecordingReenableConfirm(true);
  }, [state.setShowRecordingReenableConfirm]);

  const closeRecordingReenableConfirm = useCallback(() => {
    state.setShowRecordingReenableConfirm(false);
  }, [state.setShowRecordingReenableConfirm]);

  const reenableRecording = useCallback(() => {
    state.setShowRecordingReenableConfirm(false);
    void media.prepareRecording();
  }, [media.prepareRecording, state.setShowRecordingReenableConfirm]);

  const handlePitchStartedRecording = useCallback(() => {
    if (state.recordingStatus === "READY_TO_RECORD") {
      void media.startRecording();
    } else if (state.recordingStatus === "OPTED_OUT") {
      state.setRecordingMessage("未启用录音，仅记录路演操作。");
    } else if (state.recordingStatus === "PERMISSION_DENIED") {
      state.setRecordingMessage(
        "麦克风权限未开启，本次可继续训练，但不会保存录音。",
      );
    } else if (state.recordingStatus === "UNSUPPORTED") {
      state.setRecordingMessage("当前浏览器不支持录音，本次仅记录路演操作。");
    }
  }, [
    media.startRecording,
    state.recordingStatus,
    state.setRecordingMessage,
  ]);

  const handlePitchEndedWithoutRecording = useCallback(() => {
    media.stopMediaStream();
    state.setRecordingStatus((currentStatus) =>
      currentStatus === "OPTED_OUT" ||
      currentStatus === "PERMISSION_DENIED" ||
      currentStatus === "UNSUPPORTED"
        ? currentStatus
        : "UNDECIDED",
    );
    state.setRecordingMessage("本次未启用录音。");
  }, [
    media.stopMediaStream,
    state.setRecordingMessage,
    state.setRecordingStatus,
  ]);

  const markTranscribePreparing = useCallback(() => {
    state.setRecordingMessage("路演录音已保存，系统正在准备转写。");
  }, [state.setRecordingMessage]);

  useEffect(() => {
    return media.cleanupRecording;
  }, [media.cleanupRecording]);

  return {
    recordingStatus: state.recordingStatus,
    recordingMessage: state.recordingMessage,
    recordingId: state.recordingId,
    recordingPlaybackUrl: state.recordingPlaybackUrl,
    showRecordingPrepDialog: state.showRecordingPrepDialog,
    showRecordingOptOutConfirm: state.showRecordingOptOutConfirm,
    showRecordingReenableConfirm: state.showRecordingReenableConfirm,
    prepareRecording: media.prepareRecording,
    confirmRecordingOptOut: media.confirmRecordingOptOut,
    uploadRecording: upload.uploadRecording,
    startRecording: media.startRecording,
    stopRecordingAndUpload: media.stopRecordingAndUpload,
    stopMediaStream: media.stopMediaStream,
    isRecordingActive: media.isRecordingActive,
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
