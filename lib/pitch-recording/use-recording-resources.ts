"use client";

import { useRef } from "react";

export function useRecordingResources() {
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const recordingChunksRef = useRef<Blob[]>([]);
  const recordingStartedAtRef = useRef<Date | null>(null);
  const recordingMimeTypeRef = useRef("");
  const recordingUploadKeyRef = useRef("");
  const hasHandledPitchRecordingPreferenceRef = useRef(false);

  return {
    mediaRecorderRef,
    mediaStreamRef,
    recordingChunksRef,
    recordingStartedAtRef,
    recordingMimeTypeRef,
    recordingUploadKeyRef,
    hasHandledPitchRecordingPreferenceRef,
  };
}

export type RecordingResources = ReturnType<typeof useRecordingResources>;
