"use client";

import { useCallback } from "react";
import { useMediaRecorder } from "./use-media-recorder";
import { useRecordingStream } from "./use-recording-stream";
import type { RecordingResources } from "./use-recording-resources";
import type { RecordingState } from "./use-recording-state";

type UseRecordingMediaOptions = {
  resources: RecordingResources;
  state: RecordingState;
  uploadRecording: (
    blob: Blob,
    startedAt: Date | null,
    endedAt: Date,
  ) => Promise<string | undefined>;
  prepareRecordingUploadKey: () => void;
  clearRecordingUploadKey: () => void;
};

export function useRecordingMedia(options: UseRecordingMediaOptions) {
  const stream = useRecordingStream(options);
  const {
    confirmRecordingOptOut,
    prepareRecording,
    prepareRecordingStreamAutomatically,
    stopMediaStream,
  } = stream;
  const recorder = useMediaRecorder({
    ...options,
    stopMediaStream,
  });
  const {
    cleanupRecording,
    isRecordingActive,
    startRecording,
    stopRecordingAndUpload,
  } = recorder;

  const prepareAndStartRecordingAutomatically = useCallback(async () => {
    const isReady = await prepareRecordingStreamAutomatically();
    if (isReady) {
      await startRecording();
    }
  }, [prepareRecordingStreamAutomatically, startRecording]);

  return {
    cleanupRecording,
    confirmRecordingOptOut,
    isRecordingActive,
    prepareAndStartRecordingAutomatically,
    prepareRecording,
    startRecording,
    stopMediaStream,
    stopRecordingAndUpload,
  };
}
