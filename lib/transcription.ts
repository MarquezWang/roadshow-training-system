import { createReadStream, existsSync } from "fs";
import OpenAI from "openai";
import path from "path";
import { transcribeWithTencentFlash } from "@/lib/transcription/tencent-flash";
import { transcribeWithTencent } from "@/lib/transcription/tencent";
import { transcribeWithXfyun } from "@/lib/transcription/xfyun";

const DEFAULT_TRANSCRIPTION_MODEL = "whisper-1";

export type TranscriptionProvider = "openai" | "xfyun" | "tencent" | "tencent_flash";

export type TranscriptionSegment = {
  startMs: number;
  endMs: number;
  text: string;
  speakerId?: string | null;
};

export type TranscriptionResult = {
  text: string;
  segments: TranscriptionSegment[];
};

export function normalizeTranscriptionResult(
  result: string | TranscriptionResult,
): TranscriptionResult {
  if (typeof result === "string") {
    return {
      text: result,
      segments: [],
    };
  }

  return {
    text: result.text,
    segments: Array.isArray(result.segments) ? result.segments : [],
  };
}

export function getTranscriptionProvider(): TranscriptionProvider {
  const provider = (process.env.TRANSCRIPTION_PROVIDER ?? "openai")
    .trim()
    .toLowerCase();

  if (
    provider !== "openai" &&
    provider !== "xfyun" &&
    provider !== "tencent" &&
    provider !== "tencent_flash"
  ) {
    throw new Error(
      `不支持的转写服务商：${provider}，可选值为 openai、xfyun 或 tencent`,
    );
  }

  return provider;
}

function getAsrErrorSummary(error: unknown) {
  const message =
    error instanceof Error ? error.message : String(error ?? "unknown");

  return message
    .replace(/sk-[A-Za-z0-9_-]+/g, "[redacted]")
    .replace(/Bearer\s+[A-Za-z0-9._-]+/g, "Bearer [redacted]")
    .replace(/TENCENT_SECRET_KEY\s*=\s*\S+/gi, "TENCENT_SECRET_KEY=[redacted]")
    .slice(0, 180);
}

function getOpenAIConfig() {
  const apiKey = (process.env.TRANSCRIPTION_API_KEY ?? "").trim();

  if (!apiKey) {
    throw new Error(
      "未配置转写服务 API Key，请配置 TRANSCRIPTION_API_KEY",
    );
  }

  const baseURL = process.env.TRANSCRIPTION_BASE_URL?.trim() || undefined;
  const model =
    process.env.TRANSCRIPTION_MODEL?.trim() || DEFAULT_TRANSCRIPTION_MODEL;

  return { apiKey, baseURL, model };
}

function sanitizeError(error: unknown) {
  if (error instanceof Error) {
    return error.message
      .replace(/sk-[A-Za-z0-9_-]+/g, "[redacted]")
      .replace(/Bearer\s+[A-Za-z0-9._-]+/g, "Bearer [redacted]");
  }

  return "转写失败。";
}

async function transcribeWithOpenAI(
  filePath: string,
): Promise<string> {
  const config = getOpenAIConfig();
  const absolutePath = path.resolve(filePath);

  if (!existsSync(absolutePath)) {
    throw new Error(`音频文件不存在：${absolutePath}`);
  }

  const client = new OpenAI({
    apiKey: config.apiKey,
    baseURL: config.baseURL,
  });

  try {
    const file = createReadStream(absolutePath);
    const response = await client.audio.transcriptions.create({
      model: config.model,
      file,
      language: "zh",
      response_format: "text",
    });

    const text = typeof response === "string" ? response.trim() : "";

    if (!text) {
      throw new Error("转写结果为空。");
    }

    return text;
  } catch (error) {
    throw new Error(sanitizeError(error));
  }
}

export async function transcribeAudio(
  filePath: string,
  mimeType?: string | null,
): Promise<TranscriptionResult> {
  const provider = getTranscriptionProvider();
  const startedAt = Date.now();

  try {
    let result: TranscriptionResult;

    switch (provider) {
      case "tencent_flash":
        result = normalizeTranscriptionResult(
          await transcribeWithTencentFlash(filePath),
        );
        break;
      case "tencent":
        result = normalizeTranscriptionResult(await transcribeWithTencent(filePath));
        break;
      case "xfyun":
        result = normalizeTranscriptionResult(
          await transcribeWithXfyun(filePath, mimeType),
        );
        break;
      case "openai":
      default:
        result = normalizeTranscriptionResult(await transcribeWithOpenAI(filePath));
        break;
    }

    console.log(
      `[ASR] provider=${provider} elapsedMs=${Date.now() - startedAt} ok=true textLength=${result.text.trim().length} segments=${result.segments.length}`,
    );

    return result;
  } catch (error) {
    console.warn(
      `[ASR] provider=${provider} elapsedMs=${Date.now() - startedAt} ok=false error=${getAsrErrorSummary(error)}`,
    );
    throw error;
  }
}
