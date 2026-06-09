import OpenAI from "openai";

type CallAIOptions = {
  systemPrompt: string;
  userPrompt: string;
  temperature?: number;
  maxOutputTokens?: number;
};

type CallAIResult = {
  text: string;
  raw?: unknown;
};

const DEFAULT_TIMEOUT_MS = 60_000;
const DEFAULT_MAX_OUTPUT_TOKENS = 3_000;

function getRequiredEnv(name: string) {
  const value = process.env[name]?.trim();

  if (!value) {
    throw new Error(`缺少必要环境变量：${name}`);
  }

  return value;
}

function getAIConfig() {
  const provider = process.env.AI_PROVIDER?.trim() || "openai";

  if (provider !== "openai") {
    throw new Error(`暂不支持的 AI_PROVIDER：${provider}`);
  }

  const apiKey = getRequiredEnv("AI_API_KEY");
  const model = getRequiredEnv("AI_MODEL");
  const baseURL = process.env.AI_BASE_URL?.trim() || undefined;
  const timeoutMs = Number(process.env.AI_TIMEOUT_MS) || DEFAULT_TIMEOUT_MS;
  const maxOutputTokens =
    Number(process.env.AI_MAX_OUTPUT_TOKENS) || DEFAULT_MAX_OUTPUT_TOKENS;

  return {
    apiKey,
    baseURL,
    model,
    timeoutMs,
    maxOutputTokens,
  };
}

function sanitizeAIError(error: unknown) {
  if (error instanceof Error) {
    return error.message
      .replace(/sk-[A-Za-z0-9_-]+/g, "[redacted]")
      .replace(/Bearer\s+[A-Za-z0-9._-]+/g, "Bearer [redacted]");
  }

  return "AI 调用失败。";
}

export async function callAI(options: CallAIOptions): Promise<CallAIResult> {
  const config = getAIConfig();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), config.timeoutMs);
  const client = new OpenAI({
    apiKey: config.apiKey,
    baseURL: config.baseURL,
  });

  try {
    const completion = await client.chat.completions.create(
      {
        model: config.model,
        messages: [
          {
            role: "system",
            content: options.systemPrompt,
          },
          {
            role: "user",
            content: options.userPrompt,
          },
        ],
        temperature: options.temperature ?? 0.2,
        max_tokens: options.maxOutputTokens ?? config.maxOutputTokens,
      },
      {
        signal: controller.signal,
      },
    );
    const text = completion.choices[0]?.message?.content?.trim();

    if (!text) {
      throw new Error("AI 返回内容为空。");
    }

    return {
      text,
      raw: completion,
    };
  } catch (error) {
    if (controller.signal.aborted) {
      throw new Error(`AI 调用超时，已超过 ${config.timeoutMs}ms。`);
    }

    throw new Error(`AI 调用失败：${sanitizeAIError(error)}`);
  } finally {
    clearTimeout(timeout);
  }
}
