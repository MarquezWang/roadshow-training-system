import { stat } from "node:fs/promises";

import { BoundedProcessError, runBoundedProcess } from "./bounded-process.mjs";

const DEFAULT_MAX_AUDIO_BYTES = 100 * 1024 * 1024;
const DEFAULT_MAX_DURATION_SEC = 2 * 60 * 60;

function boundedInteger(value, fallback, minimum, maximum) {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed >= minimum && parsed <= maximum
    ? parsed
    : fallback;
}

export function getMaxTranscriptionAudioBytes() {
  return boundedInteger(
    process.env.TRANSCRIPTION_MAX_AUDIO_BYTES,
    DEFAULT_MAX_AUDIO_BYTES,
    1024 * 1024,
    250 * 1024 * 1024,
  );
}

export function getMaxTranscriptionDurationSec() {
  return boundedInteger(
    process.env.TRANSCRIPTION_MAX_DURATION_SEC,
    DEFAULT_MAX_DURATION_SEC,
    60,
    8 * 60 * 60,
  );
}

export class AudioResourceBoundaryError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "AudioResourceBoundaryError";
    this.code = code;
  }
}

/**
 * @param {string} filePath
 * @param {{
 *   signal?: AbortSignal;
 *   maxBytes?: number;
 *   maxDurationSec?: number;
 * }} [options]
 */
export async function inspectAudioResource(
  filePath,
  {
    signal,
    maxBytes = getMaxTranscriptionAudioBytes(),
    maxDurationSec = getMaxTranscriptionDurationSec(),
  } = {},
) {
  const fileInfo = await stat(filePath);
  if (!fileInfo.isFile() || fileInfo.size <= 0) {
    throw new AudioResourceBoundaryError("EMPTY", "录音文件为空或不可读取。");
  }
  if (fileInfo.size > maxBytes) {
    throw new AudioResourceBoundaryError(
      "TOO_LARGE",
      `录音文件超过 ${Math.ceil(maxBytes / 1024 / 1024)}MB 资源上限。`,
    );
  }

  let result;
  try {
    result = await runBoundedProcess(
      "ffprobe",
      [
        "-v",
        "error",
        "-print_format",
        "json",
        "-show_format",
        "-show_streams",
        filePath,
      ],
      { signal, timeoutMs: 30_000, maxOutputBytes: 256 * 1024 },
    );
  } catch (error) {
    if (error instanceof BoundedProcessError && error.code === "SPAWN_FAILED") {
      throw new AudioResourceBoundaryError(
        "FFPROBE_UNAVAILABLE",
        "ffprobe 不可用，无法在转写前校验录音时长。",
      );
    }
    throw error;
  }

  let parsed;
  try {
    parsed = JSON.parse(result.stdout);
  } catch {
    throw new AudioResourceBoundaryError(
      "INVALID_PROBE",
      "ffprobe 未返回有效的录音信息。",
    );
  }

  const audioStream = parsed.streams?.find(
    (stream) => stream.codec_type === "audio",
  );
  const durationSeconds = Number(
    parsed.format?.duration ?? audioStream?.duration ?? "0",
  );
  if (!Number.isFinite(durationSeconds) || durationSeconds <= 0) {
    throw new AudioResourceBoundaryError(
      "INVALID_DURATION",
      "无法识别录音时长，请重新录制或转换音频格式。",
    );
  }
  if (durationSeconds > maxDurationSec) {
    throw new AudioResourceBoundaryError(
      "TOO_LONG",
      `录音时长不能超过 ${Math.ceil(maxDurationSec / 60)} 分钟。`,
    );
  }

  return {
    sizeBytes: fileInfo.size,
    durationSeconds,
    codec: audioStream?.codec_name ?? "unknown",
    sampleRate: audioStream?.sample_rate ?? "unknown",
    channels: String(audioStream?.channels ?? "unknown"),
  };
}
