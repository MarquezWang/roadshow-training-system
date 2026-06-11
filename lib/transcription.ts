import { createReadStream, existsSync } from "fs";
import OpenAI from "openai";
import path from "path";

const DEFAULT_TRANSCRIPTION_MODEL = "whisper-1";

function getRequiredEnv(name: string) {
  const value = process.env[name]?.trim();

  if (!value) {
    throw new Error(`缺少必要环境变量：${name}`);
  }

  return value;
}

function getTranscriptionConfig() {
  const apiKey = getRequiredEnv("AI_API_KEY");
  const baseURL = process.env.AI_BASE_URL?.trim() || undefined;
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

export async function transcribeAudio(
  filePath: string,
): Promise<string> {
  const config = getTranscriptionConfig();
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