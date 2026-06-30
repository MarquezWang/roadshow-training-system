import OpenAI from "openai";
import { getAiModel, type AiModelTask } from "@/lib/ai-models";
import { writeDiagnosticEvent } from "@/lib/diagnostic-log";

type CallAIOptions = {
  systemPrompt: string;
  userPrompt: string;
  task?: AiModelTask;
  temperature?: number;
  maxOutputTokens?: number;
  seed?: number;
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

function getAIConfig(task: AiModelTask) {
  const provider = process.env.AI_PROVIDER?.trim() || "openai";

  if (provider !== "openai") {
    throw new Error(`暂不支持的 AI_PROVIDER：${provider}`);
  }

  const apiKey = getRequiredEnv("AI_API_KEY");
  const model = getAiModel(task);
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

function summarizeAILogError(error: unknown) {
  return sanitizeAIError(error).replace(/\s+/g, " ").slice(0, 120);
}

function logAICall({
  task,
  model,
  startedAt,
  ok,
  error,
}: {
  task: AiModelTask;
  model: string;
  startedAt: number;
  ok: boolean;
  error?: string;
}) {
  const elapsedMs = Date.now() - startedAt;
  const message = `[AI] task=${task} model=${model} elapsedMs=${elapsedMs} ok=${ok}${
    error ? ` error=${error}` : ""
  }`;

  if (ok) {
    console.log(message);
  } else {
    console.warn(message);
    void writeDiagnosticEvent({
      type: task === "reportGeneration" ? "REPORT_ERROR" : "AI_ERROR",
      message: error ? `AI call failed: ${error}` : "AI call failed",
      meta: {
        task,
        model,
        elapsedMs,
      },
    });
  }
}

export async function callAI(options: CallAIOptions): Promise<CallAIResult> {
  const task = options.task ?? "reportGeneration";
  const startedAt = Date.now();
  let model = getAiModel(task);
  let config: ReturnType<typeof getAIConfig>;

  try {
    config = getAIConfig(task);
    model = config.model;
  } catch (error) {
    logAICall({
      task,
      model,
      startedAt,
      ok: false,
      error: summarizeAILogError(error),
    });
    throw error;
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), config.timeoutMs);
  const client = new OpenAI({
    apiKey: config.apiKey,
    baseURL: config.baseURL,
  });
  let completed = false;

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
        seed: options.seed,
      },
      {
        signal: controller.signal,
      },
    );
    const text = completion.choices[0]?.message?.content?.trim();

    if (!text) {
      throw new Error("AI 返回内容为空。");
    }

    completed = true;
    return {
      text,
      raw: completion,
    };
  } catch (error) {
    const isTimeout = controller.signal.aborted;
    logAICall({
      task,
      model: config.model,
      startedAt,
      ok: false,
      error: isTimeout ? "timeout" : summarizeAILogError(error),
    });

    if (isTimeout) {
      throw new Error(`AI 调用超时，已超过 ${config.timeoutMs}ms。`);
    }

    throw new Error(`AI 调用失败：${sanitizeAIError(error)}`);
  } finally {
    if (completed) {
      logAICall({
        task,
        model: config.model,
        startedAt,
        ok: true,
      });
    }
    clearTimeout(timeout);
  }
}
