"use client";

import { useCallback } from "react";
import { createUploadIdempotencyKey } from "@/lib/client-upload-idempotency";
import { getRecordingFileExtension } from "./media-policy";
import type { RecordingResources } from "./use-recording-resources";
import type { RecordingState } from "./use-recording-state";
import type { SavedPitchRecording } from "./types";

type UseRecordingUploadOptions = {
  sessionId: string;
  onRecordingSaved?: (recording: SavedPitchRecording) => void;
  resources: RecordingResources;
  state: RecordingState;
};

export function useRecordingUpload({
  sessionId,
  onRecordingSaved,
  resources,
  state,
}: UseRecordingUploadOptions) {
  const { recordingMimeTypeRef, recordingUploadKeyRef } = resources;
  const {
    setRecordingId,
    setRecordingMessage,
    setRecordingPlaybackUrl,
    setRecordingStatus,
  } = state;

  const prepareRecordingUploadKey = useCallback(() => {
    recordingUploadKeyRef.current =
      createUploadIdempotencyKey("pitch-recording");
  }, [recordingUploadKeyRef]);

  const clearRecordingUploadKey = useCallback(() => {
    recordingUploadKeyRef.current = "";
  }, [recordingUploadKeyRef]);

  const uploadRecording = useCallback(
    async (blob: Blob, startedAt: Date | null, endedAt: Date) => {
      if (blob.size <= 0) {
        setRecordingStatus("FAILED");
        setRecordingMessage("录音文件为空，未保存。");
        return;
      }

      const mimeType =
        blob.type || recordingMimeTypeRef.current || "audio/webm";
      const extension = getRecordingFileExtension(mimeType);
      const durationSec = startedAt
        ? Math.max(
            0,
            Math.round((endedAt.getTime() - startedAt.getTime()) / 1000),
          )
        : null;
      const uploadKey =
        recordingUploadKeyRef.current ||
        createUploadIdempotencyKey("pitch-recording");
      recordingUploadKeyRef.current = uploadKey;

      setRecordingStatus("SAVING");
      setRecordingMessage("录音上传保存中...");

      try {
        const response = await fetch(`/training/${sessionId}/recordings`, {
          method: "POST",
          headers: {
            "Content-Type": mimeType,
            "Idempotency-Key": uploadKey,
            "X-Recording-Upload": "raw-v1",
            "X-Recording-Phase": "PITCH",
            "X-Recording-Name": encodeURIComponent(
              `pitch-recording.${extension}`,
            ),
            "X-Recording-Ended-At": endedAt.toISOString(),
            ...(startedAt
              ? { "X-Recording-Started-At": startedAt.toISOString() }
              : {}),
            ...(durationSec !== null
              ? { "X-Recording-Duration-Sec": String(durationSec) }
              : {}),
          },
          body: blob,
        });

        if (!response.ok) {
          const body = (await response.json().catch(() => null)) as {
            error?: string;
          } | null;

          throw new Error(body?.error ?? "录音上传失败。");
        }

        const body = (await response.json()) as {
          recording: SavedPitchRecording;
        };

        setRecordingStatus("SAVED");
        setRecordingMessage("录音已保存。");
        setRecordingId(body.recording.id);
        setRecordingPlaybackUrl(body.recording.playbackUrl);
        recordingUploadKeyRef.current = "";
        onRecordingSaved?.(body.recording);
        return body.recording.id;
      } catch (error) {
        setRecordingStatus("FAILED");
        setRecordingMessage(
          error instanceof Error ? error.message : "录音上传失败。",
        );
      }
    },
    [
      onRecordingSaved,
      recordingMimeTypeRef,
      recordingUploadKeyRef,
      sessionId,
      setRecordingId,
      setRecordingMessage,
      setRecordingPlaybackUrl,
      setRecordingStatus,
    ],
  );

  return {
    clearRecordingUploadKey,
    prepareRecordingUploadKey,
    uploadRecording,
  };
}
