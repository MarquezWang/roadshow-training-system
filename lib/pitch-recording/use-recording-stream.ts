"use client";

import { useCallback } from "react";
import {
  getPreferredAudioConstraints,
  getSupportedRecordingMimeType,
  hasLiveAudioTrack,
} from "./media-policy";
import type { RecordingResources } from "./use-recording-resources";
import type { RecordingState } from "./use-recording-state";

type UseRecordingStreamOptions = {
  clearRecordingUploadKey: () => void;
  resources: RecordingResources;
  state: RecordingState;
};

export function useRecordingStream({
  clearRecordingUploadKey,
  resources,
  state,
}: UseRecordingStreamOptions) {
  const {
    mediaRecorderRef,
    mediaStreamRef,
    recordingChunksRef,
    recordingMimeTypeRef,
    recordingStartedAtRef,
  } = resources;
  const {
    setRecordingMessage,
    setRecordingPlaybackUrl,
    setRecordingStatus,
    setShowRecordingOptOutConfirm,
    setShowRecordingPrepDialog,
    setShowRecordingReenableConfirm,
  } = state;

  const stopMediaStream = useCallback(() => {
    mediaStreamRef.current?.getTracks().forEach((track) => track.stop());
    mediaStreamRef.current = null;
  }, [mediaStreamRef]);

  const prepareRecording = useCallback(async () => {
    setRecordingPlaybackUrl("");

    if (
      typeof navigator === "undefined" ||
      !navigator.mediaDevices?.getUserMedia ||
      typeof MediaRecorder === "undefined"
    ) {
      setRecordingStatus("UNSUPPORTED");
      setRecordingMessage("当前浏览器不支持录音，本次仅记录路演操作。");
      setShowRecordingReenableConfirm(false);
      return;
    }

    if (hasLiveAudioTrack(mediaStreamRef.current)) {
      setRecordingStatus("READY_TO_RECORD");
      setRecordingMessage("麦克风已就绪，本轮将录音。");
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia(
        getPreferredAudioConstraints(),
      );

      stopMediaStream();
      mediaStreamRef.current = stream;
      recordingMimeTypeRef.current =
        getSupportedRecordingMimeType() || "audio/webm";
      setRecordingStatus("READY_TO_RECORD");
      setRecordingMessage("麦克风已就绪，本轮将录音。");
      setShowRecordingPrepDialog(false);
      setShowRecordingOptOutConfirm(false);
      setShowRecordingReenableConfirm(false);
    } catch {
      stopMediaStream();
      setRecordingStatus("PERMISSION_DENIED");
      setRecordingMessage(
        "麦克风权限未开启，本次可继续训练，但不会保存录音。",
      );
      setShowRecordingOptOutConfirm(false);
      setShowRecordingReenableConfirm(false);
    }
  }, [
    mediaStreamRef,
    recordingMimeTypeRef,
    setRecordingMessage,
    setRecordingPlaybackUrl,
    setRecordingStatus,
    setShowRecordingOptOutConfirm,
    setShowRecordingPrepDialog,
    setShowRecordingReenableConfirm,
    stopMediaStream,
  ]);

  const confirmRecordingOptOut = useCallback(() => {
    stopMediaStream();
    mediaRecorderRef.current = null;
    recordingChunksRef.current = [];
    recordingStartedAtRef.current = null;
    recordingMimeTypeRef.current = "";
    clearRecordingUploadKey();
    setRecordingStatus("OPTED_OUT");
    setRecordingPlaybackUrl("");
    setRecordingMessage("本轮未启用录音，仅记录翻页和用时。");
    setShowRecordingOptOutConfirm(false);
    setShowRecordingPrepDialog(false);
    setShowRecordingReenableConfirm(false);
  }, [
    clearRecordingUploadKey,
    mediaRecorderRef,
    recordingChunksRef,
    recordingMimeTypeRef,
    recordingStartedAtRef,
    setRecordingMessage,
    setRecordingPlaybackUrl,
    setRecordingStatus,
    setShowRecordingOptOutConfirm,
    setShowRecordingPrepDialog,
    setShowRecordingReenableConfirm,
    stopMediaStream,
  ]);

  const prepareRecordingStreamAutomatically = useCallback(async () => {
    if (
      typeof navigator === "undefined" ||
      !navigator.mediaDevices?.getUserMedia ||
      typeof MediaRecorder === "undefined"
    ) {
      setRecordingStatus("UNSUPPORTED");
      setRecordingMessage("当前浏览器不支持录音，本次仅记录翻页和用时。");
      return false;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia(
        getPreferredAudioConstraints(),
      );

      stopMediaStream();
      mediaStreamRef.current = stream;
      recordingMimeTypeRef.current =
        getSupportedRecordingMimeType() || "audio/webm";
      setRecordingStatus("READY_TO_RECORD");
      setRecordingMessage("");
      return true;
    } catch {
      stopMediaStream();
      setRecordingStatus("PERMISSION_DENIED");
      setRecordingMessage(
        "麦克风权限未开启，本轮将继续记录翻页和用时，但不会保存录音。",
      );
      return false;
    }
  }, [
    mediaStreamRef,
    recordingMimeTypeRef,
    setRecordingMessage,
    setRecordingStatus,
    stopMediaStream,
  ]);

  return {
    confirmRecordingOptOut,
    prepareRecording,
    prepareRecordingStreamAutomatically,
    stopMediaStream,
  };
}
