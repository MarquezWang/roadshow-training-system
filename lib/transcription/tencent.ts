import { createHmac, createHash } from "crypto";
import { execFile } from "child_process";
import { mkdir, readFile, rm, stat } from "fs/promises";
import path from "path";
import { promisify } from "util";
import { TranscribeBusinessError } from "@/lib/transcribe-error";

const execFileAsync = promisify(execFile);
const TENCENT_ASR_ENDPOINT = "asr.tencentcloudapi.com";
const TENCENT_ASR_SERVICE = "asr";
const TENCENT_ASR_VERSION = "2019-06-14";
const MAX_DIRECT_AUDIO_BASE64_LENGTH = 5 * 1024 * 1024;
const DEFAULT_POLL_INTERVAL_MS = 3_000;
const DEFAULT_MAX_POLL_COUNT = 120;

type TencentAsrConfig = {
  secretId: string;
  secretKey: string;
  region: string;
  engineModelType: string;
  endpoint: string;
  pollIntervalMs: number;
  maxPollCount: number;
};

type TencentAsrError = {
  Code?: string;
  Message?: string;
};

type TencentAsrResponse<T> = {
  Response?: T & {
    Error?: TencentAsrError;
    RequestId?: string;
  };
};

type CreateRecTaskResponse = {
  Data?: {
    TaskId?: number;
  };
};

type DescribeTaskStatusResponse = {
  Data?: {
    TaskId?: number;
    Status?: number | string;
    StatusStr?: string;
    Result?: string;
    ErrorMsg?: string;
    ResultDetail?: Array<{
      FinalSentence?: string;
      SliceSentence?: string;
    }>;
  };
};

function readRequiredEnv(primaryName: string, fallbackName?: string) {
  const value =
    process.env[primaryName]?.trim() ||
    (fallbackName ? process.env[fallbackName]?.trim() : "");

  if (!value) {
    throw new Error(`未配置腾讯云 ASR 环境变量：${primaryName}`);
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

function getTencentAsrConfig(): TencentAsrConfig {
  return {
    secretId: readRequiredEnv("TENCENT_SECRET_ID", "TENCENTCLOUD_SECRET_ID"),
    secretKey: readRequiredEnv(
      "TENCENT_SECRET_KEY",
      "TENCENTCLOUD_SECRET_KEY",
    ),
    region: process.env.TENCENT_ASR_REGION?.trim() || "ap-guangzhou",
    engineModelType:
      process.env.TENCENT_ASR_ENGINE_MODEL_TYPE?.trim() || "16k_zh",
    endpoint: process.env.TENCENT_ASR_ENDPOINT?.trim() || TENCENT_ASR_ENDPOINT,
    pollIntervalMs: readPositiveIntegerEnv(
      "TENCENT_ASR_POLL_INTERVAL_MS",
      DEFAULT_POLL_INTERVAL_MS,
    ),
    maxPollCount: readPositiveIntegerEnv(
      "TENCENT_ASR_MAX_POLL_COUNT",
      DEFAULT_MAX_POLL_COUNT,
    ),
  };
}

function sha256Hex(value: string) {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function hmacSha256(key: Buffer | string, value: string) {
  return createHmac("sha256", key).update(value, "utf8").digest();
}

function formatUtcDate(timestampSec: number) {
  return new Date(timestampSec * 1000).toISOString().slice(0, 10);
}

async function callTencentAsrApi<T>(
  action: "CreateRecTask" | "DescribeTaskStatus",
  payload: Record<string, unknown>,
  config: TencentAsrConfig,
): Promise<T> {
  const timestamp = Math.floor(Date.now() / 1000);
  const date = formatUtcDate(timestamp);
  const body = JSON.stringify(payload);
  const contentType = "application/json; charset=utf-8";
  const canonicalHeaders =
    `content-type:${contentType}\n` + `host:${config.endpoint}\n`;
  const signedHeaders = "content-type;host";
  const canonicalRequest = [
    "POST",
    "/",
    "",
    canonicalHeaders,
    signedHeaders,
    sha256Hex(body),
  ].join("\n");
  const credentialScope = `${date}/${TENCENT_ASR_SERVICE}/tc3_request`;
  const stringToSign = [
    "TC3-HMAC-SHA256",
    String(timestamp),
    credentialScope,
    sha256Hex(canonicalRequest),
  ].join("\n");
  const secretDate = hmacSha256(`TC3${config.secretKey}`, date);
  const secretService = hmacSha256(secretDate, TENCENT_ASR_SERVICE);
  const secretSigning = hmacSha256(secretService, "tc3_request");
  const signature = createHmac("sha256", secretSigning)
    .update(stringToSign, "utf8")
    .digest("hex");
  const authorization =
    `TC3-HMAC-SHA256 Credential=${config.secretId}/${credentialScope}, ` +
    `SignedHeaders=${signedHeaders}, Signature=${signature}`;

  const response = await fetch(`https://${config.endpoint}`, {
    method: "POST",
    headers: {
      Authorization: authorization,
      "Content-Type": contentType,
      Host: config.endpoint,
      "X-TC-Action": action,
      "X-TC-Version": TENCENT_ASR_VERSION,
      "X-TC-Timestamp": String(timestamp),
      "X-TC-Region": config.region,
    },
    body,
  });
  const rawText = await response.text();
  let parsed: TencentAsrResponse<T>;

  try {
    parsed = JSON.parse(rawText) as TencentAsrResponse<T>;
  } catch {
    throw new Error(`腾讯云 ASR 返回非 JSON：HTTP ${response.status}`);
  }

  const apiError = parsed.Response?.Error;

  if (!response.ok || apiError) {
    throw new Error(
      `腾讯云 ASR ${action} 失败：${apiError?.Message ?? `HTTP ${response.status}`}`,
    );
  }

  if (!parsed.Response) {
    throw new Error(`腾讯云 ASR ${action} 响应为空。`);
  }

  return parsed.Response;
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function convertToTencentMp3(inputPath: string) {
  const tempDir = path.resolve(process.cwd(), "tmp", "tencent-asr");
  const outputPath = path.join(
    tempDir,
    `tencent-asr-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.mp3`,
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
        "腾讯云转写需要 ffmpeg 将浏览器录音转为 MP3。请安装 ffmpeg 后重试。",
      );
    }

    throw new Error(`音频转码为腾讯云 ASR MP3 失败：${message.slice(0, 200)}`);
  }

  const outputStat = await stat(outputPath);

  if (!outputStat.isFile() || outputStat.size <= 0) {
    throw new Error("音频转码失败：ffmpeg 未生成 MP3 文件。");
  }

  return {
    outputPath,
    size: outputStat.size,
  };
}

function extractTencentResultText(data: NonNullable<DescribeTaskStatusResponse["Data"]>) {
  const detailText = data.ResultDetail?.map(
    (item) => item.FinalSentence || item.SliceSentence || "",
  )
    .join("")
    .trim();
  const rawText = (data.Result ?? "").trim();

  return (detailText || rawText)
    .replace(/\[\d+:\d+(?:\.\d+)?,\d+:\d+(?:\.\d+)?\]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function isTencentTaskSucceeded(status: unknown, statusText: string) {
  return status === 2 || status === "2" || statusText === "success";
}

function isTencentTaskFailed(status: unknown, statusText: string) {
  return status === 3 || status === "3" || statusText === "failed";
}

async function pollTencentResult(taskId: number, config: TencentAsrConfig) {
  for (let attempt = 1; attempt <= config.maxPollCount; attempt++) {
    await sleep(config.pollIntervalMs);

    const response = await callTencentAsrApi<DescribeTaskStatusResponse>(
      "DescribeTaskStatus",
      {
        TaskId: taskId,
      },
      config,
    );
    const data = response.Data;

    if (!data) {
      throw new Error("腾讯云 ASR 查询结果失败：响应中缺少 Data。");
    }

    const statusText = String(data.StatusStr ?? "").toLowerCase();

    if (isTencentTaskSucceeded(data.Status, statusText)) {
      const text = extractTencentResultText(data);

      if (!text) {
        throw new TranscribeBusinessError(
          "转写结果为空，可能是录音声音过小或没有有效语音内容。",
          `腾讯云 ASR 任务 ${taskId} 成功但结果为空。`,
        );
      }

      return text;
    }

    if (isTencentTaskFailed(data.Status, statusText)) {
      const rawMessage =
        data.ErrorMsg || `腾讯云 ASR 任务 ${taskId} 处理失败。`;

      throw new TranscribeBusinessError(
        "转写未成功，可能是音频格式、音质或服务状态异常。请稍后重试。",
        rawMessage,
      );
    }
  }

  throw new Error(`腾讯云 ASR 转写超时：任务轮询 ${config.maxPollCount} 次仍未完成。`);
}

export async function transcribeWithTencent(
  filePath: string,
): Promise<string> {
  const config = getTencentAsrConfig();
  const absolutePath = path.resolve(filePath);
  let convertedPath: string | null = null;

  try {
    const converted = await convertToTencentMp3(absolutePath);
    convertedPath = converted.outputPath;

    const audioBuffer = await readFile(converted.outputPath);
    const audioData = audioBuffer.toString("base64");

    if (audioData.length > MAX_DIRECT_AUDIO_BASE64_LENGTH) {
      throw new TranscribeBusinessError(
        "录音文件超过腾讯云直传限制，需要配置 COS 或公网音频 URL 后再转写。",
        `腾讯云 ASR Data 模式限制 5MB，转码后文件大小 ${converted.size} bytes，base64 长度 ${audioData.length}。`,
      );
    }

    const createResponse = await callTencentAsrApi<CreateRecTaskResponse>(
      "CreateRecTask",
      {
        EngineModelType: config.engineModelType,
        ChannelNum: 1,
        ResTextFormat: 0,
        SourceType: 1,
        Data: audioData,
        DataLen: audioBuffer.byteLength,
      },
      config,
    );
    const taskId = createResponse.Data?.TaskId;

    if (!taskId) {
      throw new Error("腾讯云 ASR 创建任务失败：未返回 TaskId。");
    }

    return pollTencentResult(taskId, config);
  } finally {
    if (convertedPath) {
      await rm(convertedPath, { force: true }).catch(() => {
        // ignore temp cleanup failures
      });
    }
  }
}
