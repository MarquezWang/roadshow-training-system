import { execFile } from "child_process";
import { existsSync } from "fs";
import { tmpdir } from "os";
import path from "path";
import { promisify } from "util";
import { inspectAudioResource } from "@/lib/audio-resource-boundary.mjs";
import { xfyunDebugLog } from "./debug";
import type { XfyunAudioInfo } from "./types";

const execFileAsync = promisify(execFile);

const FORMAT_TO_EXTENSION: Record<string, string> = {
  "audio/webm": "webm",
  "audio/mp4": "m4a",
  "audio/mpeg": "mp3",
  "audio/wav": "wav",
  "audio/x-wav": "wav",
};

const EXTENSION_NEEDS_CONVERSION: Record<string, boolean> = {
  webm: true,
};

export type PreparedXfyunAudio = Readonly<{
  audioPath: string;
  audioInfo: XfyunAudioInfo;
  tempConvertedPath: string | null;
}>;

function normalizeMimeType(mimeType: string) {
  return mimeType.split(";")[0]?.trim().toLowerCase() ?? "";
}

function getFileExtension(filePath: string, mimeType?: string | null) {
  const ext = path.extname(filePath).toLowerCase().replace(".", "");

  if (ext) {
    return ext;
  }

  if (mimeType) {
    return FORMAT_TO_EXTENSION[normalizeMimeType(mimeType)] ?? "wav";
  }

  return "wav";
}

function needsConversion(filePath: string, mimeType?: string | null) {
  const ext = getFileExtension(filePath, mimeType);
  return EXTENSION_NEEDS_CONVERSION[ext] === true;
}

async function probeAudio(
  filePath: string,
  signal: AbortSignal,
): Promise<XfyunAudioInfo> {
  const probe = await execFileAsync(
    "ffprobe",
    [
      "-v",
      "quiet",
      "-print_format",
      "json",
      "-show_format",
      "-show_streams",
      filePath,
    ],
    { signal, timeout: 30_000 },
  );

  const info = JSON.parse(probe.stdout) as {
    format?: { duration?: string };
    streams?: Array<{
      codec_type?: string;
      codec_name?: string;
      sample_rate?: string;
      channels?: number;
    }>;
  };

  const audioStream = info.streams?.find(
    (stream) => stream.codec_type === "audio",
  );

  const audioInfo: XfyunAudioInfo = {
    durationSeconds: Number(info.format?.duration ?? "0"),
    codec: audioStream?.codec_name ?? "unknown",
    sampleRate: audioStream?.sample_rate ?? "unknown",
    channels: String(audioStream?.channels ?? "unknown"),
  };

  xfyunDebugLog(
    `[xfyun probe] duration=${audioInfo.durationSeconds}s codec=${audioInfo.codec} sampleRate=${audioInfo.sampleRate} channels=${audioInfo.channels}`,
  );

  return audioInfo;
}

async function convertToWav(
  inputPath: string,
  signal: AbortSignal,
): Promise<{ outputPath: string; audioInfo: XfyunAudioInfo }> {
  const outputPath = path.join(
    tmpdir(),
    `xfyun-convert-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.wav`,
  );

  try {
    await execFileAsync(
      "ffmpeg",
      [
        "-y",
        "-i",
        inputPath,
        "-acodec",
        "pcm_s16le",
        "-ar",
        "16000",
        "-ac",
        "1",
        "-sample_fmt",
        "s16",
        outputPath,
      ],
      { signal, timeout: 120_000 },
    );
  } catch (error) {
    if (
      error instanceof Error &&
      "code" in error &&
      (error as NodeJS.ErrnoException).code === "ENOENT"
    ) {
      throw new Error(
        "当前录音为 WebM 格式，讯飞不支持该格式，需要 ffmpeg 转码。请安装 ffmpeg 后重试。（https://ffmpeg.org/download.html）",
      );
    }

    throw new Error(
      `音频转码失败：${error instanceof Error ? error.message : "未知错误"}`,
    );
  }

  if (!existsSync(/* turbopackIgnore: true */ outputPath)) {
    throw new Error("音频转码失败：ffmpeg 未生成输出文件。");
  }

  const inspected = await inspectAudioResource(outputPath, { signal });
  xfyunDebugLog(
    `[xfyun convert] outputPath=${outputPath} fileSize=${inspected.sizeBytes} bytes`,
  );

  const audioInfo: XfyunAudioInfo = {
    durationSeconds: inspected.durationSeconds,
    codec: inspected.codec,
    sampleRate: inspected.sampleRate,
    channels: inspected.channels,
  };
  return { outputPath, audioInfo };
}

export async function prepareXfyunAudio(
  absolutePath: string,
  mimeType: string | null | undefined,
  signal: AbortSignal,
): Promise<PreparedXfyunAudio> {
  if (needsConversion(absolutePath, mimeType)) {
    const converted = await convertToWav(absolutePath, signal);
    return {
      audioPath: converted.outputPath,
      audioInfo: converted.audioInfo,
      tempConvertedPath: converted.outputPath,
    };
  }

  return {
    audioPath: absolutePath,
    audioInfo: await probeAudio(absolutePath, signal),
    tempConvertedPath: null,
  };
}
