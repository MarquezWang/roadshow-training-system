import { PREFERRED_DEVICE_KEY } from "@/lib/use-audio-input";

const recordingMimeTypeCandidates = [
  "audio/webm;codecs=opus",
  "audio/webm",
  "audio/mp4",
  "audio/mpeg",
  "audio/wav",
];

export function getSupportedRecordingMimeType() {
  if (typeof MediaRecorder === "undefined") {
    return "";
  }

  return (
    recordingMimeTypeCandidates.find((mimeType) =>
      MediaRecorder.isTypeSupported(mimeType),
    ) ?? ""
  );
}

export function getRecordingFileExtension(mimeType: string) {
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

export function getPreferredAudioConstraints(): MediaStreamConstraints {
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

export function hasLiveAudioTrack(stream: MediaStream | null) {
  return Boolean(
    stream
      ?.getAudioTracks()
      .some((track) => track.readyState === "live"),
  );
}
