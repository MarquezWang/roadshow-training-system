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
  const recorder = useMediaRecorder({
    ...options,
    stopMediaStream: stream.stopMediaStream,
  });

  const prepareAndStartRecordingAutomatically = useCallback(async () => {
    const isReady = await stream.prepareRecordingStreamAutomatically();
    if (isReady) {
      await recorder.startRecording();
    }
  }, [
    recorder.startRecording,
    stream.prepareRecordingStreamAutomatically,
  ]);

  return {
    cleanupRecording: recorder.cleanupRecording,
    confirmRecordingOptOut: stream.confirmRecordingOptOut,
    isRecordingActive: recorder.isRecordingActive,
    prepareAndStartRecordingAutomatically,
    prepareRecording: stream.prepareRecording,
    startRecording: recorder.startRecording,
    stopMediaStream: stream.stopMediaStream,
    stopRecordingAndUpload: recorder.stopRecordingAndUpload,
  };
}
