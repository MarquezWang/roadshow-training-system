"use client";

import { useCallback, useRef, useState } from "react";
import { PREFERRED_DEVICE_KEY } from "@/lib/use-audio-input";

const recordingMimeTypeCandidates = [
  "audio/webm;codecs=opus",
  "audio/webm",
  "audio/mp4",
  "audio/mpeg",
  "audio/wav",
];

function getSupportedRecordingMimeType() {
  if (typeof MediaRecorder === "undefined") {
    return "";
  }

  return (
    recordingMimeTypeCandidates.find((mimeType) =>
      MediaRecorder.isTypeSupported(mimeType),
    ) ?? ""
  );
}

function getRecordingFileExtension(mimeType: string) {
  const normalizedMimeType = mimeType.split(";")[0]?.toLowerCase() ?? "";

  if (normalizedMimeType === "audio/mp4") {
    return "m4a";
  }

  if (normalizedMimeType === "audio/mpeg") {
    return "mp3";
  }

  if (normalizedMimeType === "audio/wav") {
    return "wav";
  }

  return "webm";
}

function getPreferredAudioConstraints(): MediaStreamConstraints {
  if (typeof window === "undefined") return { audio: true };
  try {
    const deviceId = localStorage.getItem(PREFERRED_DEVICE_KEY);
    if (deviceId) {
      return { audio: { deviceId: { exact: deviceId } } };
    }
  } catch {
    // localStorage 不可用
  }
  return { audio: true };
}

type UseQaRecordingOptions = {
  sessionId: string;
};

export function useQaRecording({ sessionId }: UseQaRecordingOptions) {
  const [, setQaRecordingMessage] = useState("");
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const recordingChunksRef = useRef<Blob[]>([]);
  const recordingStartedAtRef = useRef<Date | null>(null);
  const recordingMimeTypeRef = useRef("");

  const startQuestionRecording = useCallback(async () => {
    if (
      typeof navigator === "undefined" ||
      !navigator.mediaDevices?.getUserMedia ||
      typeof MediaRecorder === "undefined"
    ) {
      setQaRecordingMessage("本题未启用录音。");
      return;
    }

    const mimeType = getSupportedRecordingMimeType();

    if (!mimeType) {
      setQaRecordingMessage("当前浏览器不支持答辩录音，本题未启用录音。");
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia(
        getPreferredAudioConstraints(),
      );
      const recorder = new MediaRecorder(stream, { mimeType });

      recordingChunksRef.current = [];
      recordingStartedAtRef.current = new Date();
      recordingMimeTypeRef.current = mimeType;
      mediaStreamRef.current = stream;
      mediaRecorderRef.current = recorder;
      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          recordingChunksRef.current.push(event.data);
        }
      };
      recorder.start();
      setQaRecordingMessage("本题录音中。");
    } catch {
      setQaRecordingMessage("本题未启用录音。");
    }
  }, []);

  const stopAndUploadCurrentRecording = useCallback(async () => {
    const recorder = mediaRecorderRef.current;
    const stream = mediaStreamRef.current;

    if (!recorder || recorder.state === "inactive") {
      stream?.getTracks().forEach((track) => track.stop());
      mediaRecorderRef.current = null;
      mediaStreamRef.current = null;
      return null;
    }

    const stoppedAt = new Date();
    const startedAt = recordingStartedAtRef.current;
    const mimeType = recordingMimeTypeRef.current || recorder.mimeType;
    const stopped = new Promise<void>((resolve) => {
      recorder.onstop = () => resolve();
    });

    recorder.stop();
    await stopped;
    stream?.getTracks().forEach((track) => track.stop());
    mediaRecorderRef.current = null;
    mediaStreamRef.current = null;

    if (recordingChunksRef.current.length === 0 || !mimeType) {
      setQaRecordingMessage("本题未保存录音。");
      return null;
    }

    const blob = new Blob(recordingChunksRef.current, { type: mimeType });
    const formData = new FormData();
    const durationSec = startedAt
      ? Math.max(0, Math.round((stoppedAt.getTime() - startedAt.getTime()) / 1000))
      : null;

    formData.append(
      "file",
      blob,
      `qa-answer.${getRecordingFileExtension(mimeType)}`,
    );
    formData.append("phase", "QA");
    formData.append("startedAt", startedAt?.toISOString() ?? "");
    formData.append("endedAt", stoppedAt.toISOString());

    if (durationSec !== null) {
      formData.append("durationSec", String(durationSec));
    }

    try {
      const response = await fetch(`/training/${sessionId}/recordings`, {
        method: "POST",
        body: formData,
      });
      const body = (await response.json().catch(() => null)) as {
        recording?: { id?: string };
        error?: string;
      } | null;

      if (!response.ok || !body?.recording?.id) {
        throw new Error(body?.error ?? "本题录音保存失败。");
      }

      setQaRecordingMessage("本题录音已保存。");

      // 后台触发转写，不阻塞 UI
      void fetch(
        `/training/${sessionId}/recordings/${body.recording.id}/transcribe`,
        { method: "POST" },
      ).catch(() => {
        // 转写失败不影响答题流程
      });

      return body.recording.id;
    } catch (error) {
      setQaRecordingMessage(
        error instanceof Error ? error.message : "本题录音保存失败。",
      );
      return null;
    }
  }, [sessionId]);

  const cleanupRecording = useCallback(() => {
    if (mediaRecorderRef.current?.state === "recording") {
      mediaRecorderRef.current.stop();
    }
    mediaStreamRef.current?.getTracks().forEach((track) => track.stop());
  }, []);

  const clearRecordingMessage = useCallback(() => {
    setQaRecordingMessage("");
  }, []);

  return {
    clearRecordingMessage,
    cleanupRecording,
    startQuestionRecording,
    stopAndUploadCurrentRecording,
  };
}
