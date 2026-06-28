import { createHmac } from "crypto";
import { execFile } from "child_process";
import { mkdir, readFile, rm, stat } from "fs/promises";
import path from "path";
import { promisify } from "util";
import { TranscribeBusinessError } from "@/lib/transcribe-error";

const execFileAsync = promisify(execFile);

const TENCENT_FLASH_HOST = "asr.cloud.tencent.com";
const TENCENT_FLASH_PATH_PREFIX = "/asr/flash/v1";
const DEFAULT_ENGINE_TYPE = "16k_zh";
const DEFAULT_VOICE_FORMAT = "mp3";
const DEFAULT_TIMEOUT_MS = 120_000;
const MAX_FLASH_AUDIO_BYTES = 100 * 1024 * 1024;

type TencentFlashConfig = {
  appId: string;
  secretId: string;
  secretKey: string;
  engineType: string;
  voiceFormat: string;
  timeoutMs: number;
};

type TencentFlashSentence = {
  text?: string;
};

type TencentFlashResult = {
  text?: string;
  sentence_list?: TencentFlashSentence[];
};

type TencentFlashResponse = {
  request_id?: string;
  code?: number;
  message?: string;
  flash_result?: TencentFlashResult[];
};

function readRequiredEnv(primaryName: string, fallbackName?: string) {
  const value =
    process.env[primaryName]?.trim() ||
    (fallbackName ? process.env[fallbackName]?.trim() : "");

  if (!value) {
    throw new Error(`未配置腾讯云极速版 ASR 环境变量：${primaryName}`);
  }

  return value;
}

function readPositiveIntegerEnv(name: string, fallback: number) {
  const value = process.env[name]?.trim();

  if (!value) {
    return fallback;
  }

  const parsed = Number(value);

  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function getTencentFlashConfig(): TencentFlashConfig {
  return {
    appId: readRequiredEnv("TENCENT_APP_ID", "TENCENTCLOUD_APP_ID"),
    secretId: readRequiredEnv("TENCENT_SECRET_ID", "TENCENTCLOUD_SECRET_ID"),
    secretKey: readRequiredEnv(
      "TENCENT_SECRET_KEY",
      "TENCENTCLOUD_SECRET_KEY",
    ),
    engineType:
      process.env.TENCENT_ASR_FLASH_ENGINE_TYPE?.trim() ||
      process.env.TENCENT_ASR_ENGINE_MODEL_TYPE?.trim() ||
      DEFAULT_ENGINE_TYPE,
    voiceFormat:
      process.env.TENCENT_ASR_FLASH_VOICE_FORMAT?.trim() ||
      DEFAULT_VOICE_FORMAT,
    timeoutMs: readPositiveIntegerEnv(
      "TENCENT_ASR_FLASH_TIMEOUT_MS",
      DEFAULT_TIMEOUT_MS,
    ),
  };
}

async function convertToTencentFlashMp3(inputPath: string) {
  const tempDir = path.resolve(process.cwd(), "tmp", "tencent-asr-flash");
  const outputPath = path.join(
    tempDir,
    `tencent-asr-flash-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.mp3`,
  );

  await mkdir(tempDir, { recursive: true });

  try {
    await execFileAsync(
      "ffmpeg",
      [
        "-y",
        "-i",
        inputPath,
        "-vn",
        "-ac",
        "1",
        "-ar",
        "16000",
        "-b:a",
        "48k",
        outputPath,
      ],
      {
        timeout: 120_000,
      },
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);

    if (message.toLowerCase().includes("enoent")) {
      throw new Error(
        "腾讯云极速版转写需要 ffmpeg 将浏览器录音转为 MP3。请安装 ffmpeg 后重试。",
      );
    }

    throw new Error(`音频转码为腾讯云极速版 ASR MP3 失败：${message.slice(0, 200)}`);
  }

  const outputStat = await stat(outputPath);

  if (!outputStat.isFile() || outputStat.size <= 0) {
    throw new Error("音频转码失败：ffmpeg 未生成 MP3 文件。");
  }

  if (outputStat.size > MAX_FLASH_AUDIO_BYTES) {
    throw new TranscribeBusinessError(
      "录音文件超过腾讯云极速版直传限制，请缩短录音或压缩音频后重试。",
      `腾讯云极速版 ASR 限制 100MB，转码后文件大小 ${outputStat.size} bytes。`,
    );
  }

  return {
    outputPath,
    size: outputStat.size,
  };
}

function buildQueryParams(config: TencentFlashConfig) {
  return {
    convert_num_mode: "1",
    engine_type: config.engineType,
    filter_dirty: "0",
    filter_modal: "0",
    filter_punc: "0",
    first_channel_only: "1",
    secretid: config.secretId,
    speaker_diarization: "0",
    timestamp: String(Math.floor(Date.now() / 1000)),
    voice_format: config.voiceFormat,
    word_info: "0",
  };
}

function buildSignedUrl(config: TencentFlashConfig) {
  const pathPart = `${TENCENT_FLASH_PATH_PREFIX}/${config.appId}`;
  const params = buildQueryParams(config);
  const queryForSignature = Object.entries(params)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, value]) => `${key}=${value}`)
    .join("&");
  const signaturePayload = `POST${TENCENT_FLASH_HOST}${pathPart}?${queryForSignature}`;
  const signature = createHmac("sha1", config.secretKey)
    .update(signaturePayload, "utf8")
    .digest("base64");
  const searchParams = new URLSearchParams(params);

  return {
    url: `https://${TENCENT_FLASH_HOST}${pathPart}?${searchParams.toString()}`,
    signature,
  };
}

function extractTencentFlashText(result: TencentFlashResponse) {
  return (result.flash_result ?? [])
    .map((item) => {
      const sentenceText = item.sentence_list
        ?.map((sentence) => sentence.text ?? "")
        .join("")
        .trim();

      return sentenceText || item.text || "";
    })
    .join("")
    .replace(/\s+/g, " ")
    .trim();
}

async function callTencentFlashApi(
  config: TencentFlashConfig,
  audioBuffer: Buffer,
) {
  const { url, signature } = buildSignedUrl(config);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), config.timeoutMs);

  try {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: signature,
        "Content-Type": "application/octet-stream",
        Host: TENCENT_FLASH_HOST,
      },
      body: new Uint8Array(audioBuffer),
      signal: controller.signal,
    });
    const rawText = await response.text();
    let parsed: TencentFlashResponse;

    try {
      parsed = JSON.parse(rawText) as TencentFlashResponse;
    } catch {
      throw new Error(`腾讯云极速版 ASR 返回非 JSON：HTTP ${response.status}`);
    }

    if (!response.ok || parsed.code !== 0) {
      const requestId = parsed.request_id ? ` requestId=${parsed.request_id}` : "";

      throw new TranscribeBusinessError(
        "转写未成功，可能是音频格式、音质或腾讯云服务状态异常。请稍后重试。",
        `腾讯云极速版 ASR 失败：code=${parsed.code ?? response.status} message=${parsed.message ?? "unknown"}${requestId}`,
      );
    }

    return parsed;
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") {
      throw new Error(`腾讯云极速版 ASR 请求超时：${config.timeoutMs}ms。`);
    }

    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

export async function transcribeWithTencentFlash(
  filePath: string,
): Promise<string> {
  const config = getTencentFlashConfig();
  const absolutePath = path.resolve(filePath);
  let convertedPath: string | null = null;

  try {
    const converted = await convertToTencentFlashMp3(absolutePath);
    convertedPath = converted.outputPath;

    const audioBuffer = await readFile(converted.outputPath);
    const result = await callTencentFlashApi(config, audioBuffer);
    const text = extractTencentFlashText(result);

    if (!text) {
      throw new TranscribeBusinessError(
        "转写结果为空，可能是录音声音过小或没有有效语音内容。",
        `腾讯云极速版 ASR 成功但结果为空 requestId=${result.request_id ?? "unknown"}`,
      );
    }

    return text;
  } finally {
    if (convertedPath) {
      await rm(convertedPath, { force: true }).catch(() => {
        // ignore temp cleanup failures
      });
    }
  }
}
