"use client";

import { useCallback } from "react";
import {
  getSupportedRecordingMimeType,
  hasLiveAudioTrack,
} from "./media-policy";
import type { RecordingResources } from "./use-recording-resources";
import type { RecordingState } from "./use-recording-state";

type UseMediaRecorderOptions = {
  prepareRecordingUploadKey: () => void;
  resources: RecordingResources;
  state: RecordingState;
  stopMediaStream: () => void;
  uploadRecording: (
    blob: Blob,
    startedAt: Date | null,
    endedAt: Date,
  ) => Promise<string | undefined>;
};

export function useMediaRecorder({
  prepareRecordingUploadKey,
  resources,
  state,
  stopMediaStream,
  uploadRecording,
}: UseMediaRecorderOptions) {
  const {
    mediaRecorderRef,
    mediaStreamRef,
    recordingChunksRef,
    recordingMimeTypeRef,
    recordingStartedAtRef,
  } = resources;
  const {
    recordingStatus,
    setRecordingMessage,
    setRecordingPlaybackUrl,
    setRecordingStatus,
  } = state;

  const startRecording = useCallback(async () => {
    setRecordingPlaybackUrl("");

    if (typeof MediaRecorder === "undefined") {
      setRecordingStatus("UNSUPPORTED");
      setRecordingMessage("当前浏览器不支持录音，本次仅记录路演操作。");
      return;
    }

    const stream = mediaStreamRef.current;

    if (!stream || !hasLiveAudioTrack(stream)) {
      if (recordingStatus === "PERMISSION_DENIED") {
        setRecordingMessage(
          "麦克风权限未开启，本次可继续训练，但不会保存录音。",
        );
        return;
      }

      if (recordingStatus === "UNSUPPORTED") {
        setRecordingMessage("当前浏览器不支持录音，本次仅记录路演操作。");
        return;
      }

      if (recordingStatus === "OPTED_OUT") {
        setRecordingMessage("未启用录音，仅记录路演操作。");
        return;
      }

      setRecordingStatus("UNDECIDED");
      setRecordingMessage("未启用录音，仅记录路演操作。");
      return;
    }

    const mimeType =
      recordingMimeTypeRef.current || getSupportedRecordingMimeType();

    try {
      const recorder = mimeType
        ? new MediaRecorder(stream, { mimeType })
        : new MediaRecorder(stream);

      mediaRecorderRef.current = recorder;
      recordingChunksRef.current = [];
      recordingStartedAtRef.current = new Date();
      recordingMimeTypeRef.current =
        recorder.mimeType || mimeType || "audio/webm";
      prepareRecordingUploadKey();

      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          recordingChunksRef.current.push(event.data);
        }
      };
      recorder.onerror = () => {
        setRecordingStatus("FAILED");
        setRecordingMessage("录音过程中出现错误，本次可能无法保存音频。");
      };
      recorder.start(1000);

      setRecordingStatus("RECORDING");
      setRecordingMessage("");
    } catch {
      stopMediaStream();
      mediaRecorderRef.current = null;
      recordingStartedAtRef.current = null;
      recordingChunksRef.current = [];
      setRecordingStatus("FAILED");
      setRecordingMessage("录音启动失败，本次仅记录路演操作。");
    }
  }, [
    mediaRecorderRef,
    mediaStreamRef,
    prepareRecordingUploadKey,
    recordingChunksRef,
    recordingMimeTypeRef,
    recordingStartedAtRef,
    recordingStatus,
    setRecordingMessage,
    setRecordingPlaybackUrl,
    setRecordingStatus,
    stopMediaStream,
  ]);

  const stopRecordingAndUpload = useCallback(async () => {
    const recorder = mediaRecorderRef.current;

    if (!recorder || recorder.state === "inactive") {
      stopMediaStream();
      return;
    }

    return new Promise<string | undefined>((resolve) => {
      recorder.onstop = () => {
        const endedAt = new Date();
        const blob = new Blob(recordingChunksRef.current, {
          type:
            recordingMimeTypeRef.current || recorder.mimeType || "audio/webm",
        });

        mediaRecorderRef.current = null;
        stopMediaStream();
        void uploadRecording(blob, recordingStartedAtRef.current, endedAt)
          .then((savedRecordingId) => {
            recordingChunksRef.current = [];
            recordingStartedAtRef.current = null;
            recordingMimeTypeRef.current = "";
            resolve(savedRecordingId);
          })
          .catch(() => {
            recordingChunksRef.current = [];
            recordingStartedAtRef.current = null;
            recordingMimeTypeRef.current = "";
            resolve(undefined);
          });
      };

      try {
        recorder.requestData();
        recorder.stop();
      } catch {
        mediaRecorderRef.current = null;
        stopMediaStream();
        setRecordingStatus("FAILED");
        setRecordingMessage("停止录音失败，未保存音频。");
        resolve(undefined);
      }
    });
  }, [
    mediaRecorderRef,
    recordingChunksRef,
    recordingMimeTypeRef,
    recordingStartedAtRef,
    setRecordingMessage,
    setRecordingStatus,
    stopMediaStream,
    uploadRecording,
  ]);

  const isRecordingActive = useCallback(
    () => mediaRecorderRef.current?.state === "recording",
    [mediaRecorderRef],
  );

  const cleanupRecording = useCallback(() => {
    if (mediaRecorderRef.current?.state === "recording") {
      mediaRecorderRef.current.stop();
    }

    stopMediaStream();
  }, [mediaRecorderRef, stopMediaStream]);

  return {
    cleanupRecording,
    isRecordingActive,
    startRecording,
    stopRecordingAndUpload,
  };
}
