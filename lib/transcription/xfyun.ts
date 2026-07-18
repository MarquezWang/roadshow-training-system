import { existsSync } from "fs";
import { unlink } from "fs/promises";
import path from "path";
import { throwIfTranscriptionAborted } from "@/lib/transcription-abort.mjs";
import { prepareXfyunAudio } from "./xfyun/audio";
import { uploadXfyunAudio } from "./xfyun/client";
import { getXfyunConfig } from "./xfyun/config";
import {
  KEEP_XFYUN_TEMP_AUDIO,
  saveXfyunDebugJson,
  XFYUN_DEBUG_DIR,
  xfyunDebugLog,
} from "./xfyun/debug";
import { pollXfyunResult } from "./xfyun/polling";

export async function transcribeWithXfyun(
  filePath: string,
  mimeType?: string | null,
  signal: AbortSignal = new AbortController().signal,
): Promise<string> {
  const config = getXfyunConfig();
  const absolutePath = path.resolve(filePath);

  if (!existsSync(absolutePath)) {
    throw new Error(`音频文件不存在：${absolutePath}`);
  }

  let tempConvertedPath: string | null = null;
  let debugAudioPath: string | null = null;

  try {
    throwIfTranscriptionAborted(signal);
    const preparedAudio = await prepareXfyunAudio(
      absolutePath,
      mimeType,
      signal,
    );
    tempConvertedPath = preparedAudio.tempConvertedPath;

    if (KEEP_XFYUN_TEMP_AUDIO) {
      debugAudioPath = preparedAudio.audioPath;
      xfyunDebugLog(
        preparedAudio.tempConvertedPath
          ? `[xfyun debug] 保留转码 wav: ${debugAudioPath}`
          : `[xfyun debug] 原始音频路径: ${debugAudioPath}`,
      );
    }

    const uploadResult = await uploadXfyunAudio(
      preparedAudio.audioPath,
      config,
      preparedAudio.audioInfo,
      XFYUN_DEBUG_DIR,
      signal,
    );

    const text = await pollXfyunResult(
      uploadResult.orderId,
      config,
      {
        uploadFileName: uploadResult.uploadFileName,
        uploadFileSize: uploadResult.uploadFileSize,
        uploadDurationMs: uploadResult.uploadDurationMs,
        audioInfo: preparedAudio.audioInfo,
      },
      uploadResult.debugDir,
      debugAudioPath,
      signal,
    );

    const summary = {
      orderId: uploadResult.orderId,
      uploadFileName: uploadResult.uploadFileName,
      uploadFileSize: uploadResult.uploadFileSize,
      uploadDurationMs: uploadResult.uploadDurationMs,
      ffprobeDurationSeconds: preparedAudio.audioInfo.durationSeconds,
      sampleRate: preparedAudio.audioInfo.sampleRate,
      channels: preparedAudio.audioInfo.channels,
      codec: preparedAudio.audioInfo.codec,
      debugAudioPath,
      status: "completed",
    };
    await saveXfyunDebugJson(
      XFYUN_DEBUG_DIR,
      "debug-summary.json",
      JSON.stringify(summary, null, 2),
    );

    return text;
  } catch (error) {
    const summary = {
      orderId: "unknown",
      debugAudioPath,
      status: "failed",
      error: error instanceof Error ? error.message : "未知错误",
    };
    await saveXfyunDebugJson(
      XFYUN_DEBUG_DIR,
      "debug-summary.json",
      JSON.stringify(summary, null, 2),
    ).catch(() => {});

    throw error;
  } finally {
    if (tempConvertedPath && !KEEP_XFYUN_TEMP_AUDIO) {
      try {
        await unlink(tempConvertedPath);
      } catch {
        // 清理临时文件失败不影响主流程
      }
    }
  }
}
