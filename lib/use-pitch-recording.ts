"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { PREFERRED_DEVICE_KEY } from "@/lib/use-audio-input";
import type { TrainingTranscript } from "@/lib/use-pitch-transcript";

export type TrainingRecording = {
  id: string;
  phase: string;
  status: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  durationSec: number | null;
  startedAt: string | null;
  endedAt: string | null;
  playbackUrl: string;
  transcript: TrainingTranscript | null;
};

export type RecordingStatus =
  | "UNDECIDED"
  | "READY_TO_RECORD"
  | "OPTED_OUT"
  | "RECORDING"
  | "SAVING"
  | "SAVED"
  | "FAILED"
  | "UNSUPPORTED"
  | "PERMISSION_DENIED";

export type SavedPitchRecording = {
  id: string;
  playbackUrl: string;
  mimeType: string;
};

type UsePitchRecordingOptions = {
  sessionId: string;
  initialStatus: string;
  initialRecording: TrainingRecording | null;
  autoStartRecordingOnMount: boolean;
  isPitching: boolean;
  isGuardResolved: boolean;
  onRecordingSaved?: (recording: SavedPitchRecording) => void;
};

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

export function usePitchRecording({
  sessionId,
  initialStatus,
  initialRecording,
  autoStartRecordingOnMount,
  isPitching,
  isGuardResolved,
  onRecordingSaved,
}: UsePitchRecordingOptions) {
  const [recordingStatus, setRecordingStatus] =
    useState<RecordingStatus>(initialRecording ? "SAVED" : "UNDECIDED");
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
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const recordingChunksRef = useRef<Blob[]>([]);
  const recordingStartedAtRef = useRef<Date | null>(null);
  const recordingMimeTypeRef = useRef("");
  const hasHandledPitchRecordingPreferenceRef = useRef(false);

  const stopMediaStream = useCallback(() => {
    mediaStreamRef.current?.getTracks().forEach((track) => track.stop());
    mediaStreamRef.current = null;
  }, []);

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

    if (
      mediaStreamRef.current
        ?.getAudioTracks()
        .some((track) => track.readyState === "live")
    ) {
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
  }, [stopMediaStream]);

  const confirmRecordingOptOut = useCallback(() => {
    stopMediaStream();
    mediaRecorderRef.current = null;
    recordingChunksRef.current = [];
    recordingStartedAtRef.current = null;
    recordingMimeTypeRef.current = "";
    setRecordingStatus("OPTED_OUT");
    setRecordingPlaybackUrl("");
    setRecordingMessage("本轮未启用录音，仅记录翻页和用时。");
    setShowRecordingOptOutConfirm(false);
    setShowRecordingPrepDialog(false);
    setShowRecordingReenableConfirm(false);
  }, [stopMediaStream]);

  const uploadRecording = useCallback(
    async (blob: Blob, startedAt: Date | null, endedAt: Date) => {
      if (blob.size <= 0) {
        setRecordingStatus("FAILED");
        setRecordingMessage("录音文件为空，未保存。");
        return;
      }

      const formData = new FormData();
      const mimeType =
        blob.type || recordingMimeTypeRef.current || "audio/webm";
      const extension = getRecordingFileExtension(mimeType);
      const durationSec = startedAt
        ? Math.max(
            0,
            Math.round((endedAt.getTime() - startedAt.getTime()) / 1000),
          )
        : null;

      formData.append("file", blob, `pitch-recording.${extension}`);
      formData.append("phase", "PITCH");
      formData.append("endedAt", endedAt.toISOString());

      if (startedAt) {
        formData.append("startedAt", startedAt.toISOString());
      }

      if (durationSec !== null) {
        formData.append("durationSec", String(durationSec));
      }

      setRecordingStatus("SAVING");
      setRecordingMessage("录音上传保存中...");

      try {
        const response = await fetch(`/training/${sessionId}/recordings`, {
          method: "POST",
          body: formData,
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
        onRecordingSaved?.(body.recording);
        return body.recording.id;
      } catch (error) {
        setRecordingStatus("FAILED");
        setRecordingMessage(
          error instanceof Error ? error.message : "录音上传失败。",
        );
      }
    },
    [onRecordingSaved, sessionId],
  );

  const startRecording = useCallback(async () => {
    setRecordingPlaybackUrl("");

    if (typeof MediaRecorder === "undefined") {
      setRecordingStatus("UNSUPPORTED");
      setRecordingMessage("当前浏览器不支持录音，本次仅记录路演操作。");
      return;
    }

    const stream = mediaStreamRef.current;
    const hasLiveAudioTrack = stream
      ?.getAudioTracks()
      .some((track) => track.readyState === "live");

    if (!stream || !hasLiveAudioTrack) {
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
  }, [recordingStatus, stopMediaStream]);

  useEffect(() => {
    if (
      !autoStartRecordingOnMount ||
      !isPitching ||
      !isGuardResolved ||
      hasHandledPitchRecordingPreferenceRef.current ||
      initialRecording
    ) {
      return;
    }

    hasHandledPitchRecordingPreferenceRef.current = true;
    const preference =
      window.sessionStorage.getItem(
        `training:${sessionId}:recordingPreference`,
      ) ?? "skip";

    if (preference !== "record") {
      window.setTimeout(() => {
        setRecordingStatus("OPTED_OUT");
        setRecordingMessage("本轮未启用录音，仅记录翻页和用时。");
      }, 0);
      return;
    }

    async function prepareAndStartRecording() {
      if (
        typeof navigator === "undefined" ||
        !navigator.mediaDevices?.getUserMedia ||
        typeof MediaRecorder === "undefined"
      ) {
        setRecordingStatus("UNSUPPORTED");
        setRecordingMessage(
          "当前浏览器不支持录音，本次仅记录翻页和用时。",
        );
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
        setRecordingMessage("");
        await startRecording();
      } catch {
        stopMediaStream();
        setRecordingStatus("PERMISSION_DENIED");
        setRecordingMessage(
          "麦克风权限未开启，本轮将继续记录翻页和用时，但不会保存录音。",
        );
      }
    }

    void prepareAndStartRecording();
  }, [
    autoStartRecordingOnMount,
    initialRecording,
    isGuardResolved,
    isPitching,
    sessionId,
    startRecording,
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
          type: recordingMimeTypeRef.current || recorder.mimeType || "audio/webm",
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
  }, [stopMediaStream, uploadRecording]);

  const isRecordingActive = useCallback(
    () => mediaRecorderRef.current?.state === "recording",
    [],
  );

  const openRecordingPrepDialog = useCallback(() => {
    setShowRecordingPrepDialog(true);
    setShowRecordingOptOutConfirm(false);
  }, []);

  const openRecordingOptOutConfirm = useCallback(() => {
    setShowRecordingOptOutConfirm(true);
  }, []);

  const closeRecordingOptOutConfirm = useCallback(() => {
    setShowRecordingOptOutConfirm(false);
  }, []);

  const openRecordingReenableConfirm = useCallback(() => {
    setShowRecordingReenableConfirm(true);
  }, []);

  const closeRecordingReenableConfirm = useCallback(() => {
    setShowRecordingReenableConfirm(false);
  }, []);

  const reenableRecording = useCallback(() => {
    setShowRecordingReenableConfirm(false);
    void prepareRecording();
  }, [prepareRecording]);

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
  }, [recordingStatus, startRecording]);

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
  }, [stopMediaStream]);

  const markTranscribePreparing = useCallback(() => {
    setRecordingMessage("路演录音已保存，系统正在准备转写。");
  }, []);

  useEffect(() => {
    return () => {
      if (mediaRecorderRef.current?.state === "recording") {
        mediaRecorderRef.current.stop();
      }

      stopMediaStream();
    };
  }, [stopMediaStream]);

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
    uploadRecording,
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
