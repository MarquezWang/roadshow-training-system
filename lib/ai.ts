import OpenAI from "openai";
import { getAiModel, type AiModelTask } from "@/lib/ai-models";
import {
  acquireAIResources,
  AIResourceLimitError,
  reconcileAIUsage,
  recordAIProviderFailure,
  recordAIProviderSuccess,
} from "@/lib/ai-resource-guard";
import { writeDiagnosticEvent } from "@/lib/diagnostic-log";
import { UNTRUSTED_DATA_SYSTEM_POLICY } from "@/lib/prompt-data-boundary";

type CallAIOptions = {
  systemPrompt: string;
  userPrompt: string;
  task?: AiModelTask;
  temperature?: number;
  maxOutputTokens?: number;
  seed?: number;
  disableJsonResponseFormat?: boolean;
  projectId?: string;
};

type CallAIResult = {
  text: string;
  model: string;
  raw?: unknown;
};

export class AIEmptyContentError extends Error {
  task: AiModelTask;
  model: string;
  responseFormat: "json_object" | null;
  finishReason: string | null;

  constructor(
    message: string,
    details: {
      task: AiModelTask;
      model: string;
      responseFormat: "json_object" | null;
      finishReason: string | null;
    },
  ) {
    super(message);
    this.name = "AIEmptyContentError";
    this.task = details.task;
    this.model = details.model;
    this.responseFormat = details.responseFormat;
    this.finishReason = details.finishReason;
  }
}

const DEFAULT_TIMEOUT_MS = 60_000;
const DEFAULT_MAX_OUTPUT_TOKENS = 3_000;

function getRequiredEnv(name: string) {
  const value = process.env[name]?.trim();

  if (!value) {
    throw new Error(`缺少必要环境变量：${name}`);
  }

  return value;
}

function getBoundedIntegerEnv(
  name: string,
  fallback: number,
  minimum: number,
  maximum: number,
) {
  const raw = process.env[name]?.trim();
  if (!raw) return fallback;

  const value = Number(raw);
  if (!Number.isInteger(value) || value < minimum || value > maximum) {
    throw new Error(`${name} 必须是 ${minimum} 到 ${maximum} 之间的整数。`);
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
  const timeoutMs = getBoundedIntegerEnv(
    "AI_TIMEOUT_MS",
    DEFAULT_TIMEOUT_MS,
    1_000,
    5 * 60_000,
  );
  const maxOutputTokens = getBoundedIntegerEnv(
    "AI_MAX_OUTPUT_TOKENS",
    DEFAULT_MAX_OUTPUT_TOKENS,
    100,
    100_000,
  );

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

function isReportJsonTask(task: AiModelTask) {
  return task === "pitchAnalysis" || task === "reportGeneration";
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
      type: isReportJsonTask(task) ? "REPORT_ERROR" : "AI_ERROR",
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
  let userKey = "system";
  try {
    const { getCurrentAuthUser } = await import("@/lib/auth-server");
    userKey = (await getCurrentAuthUser())?.id ?? "local";
  } catch {
    userKey = "system";
  }
  const projectKey = options.projectId?.trim() || "unscoped";
  const requestedOutputTokens = options.maxOutputTokens ?? config.maxOutputTokens;
  if (
    !Number.isInteger(requestedOutputTokens) ||
    requestedOutputTokens < 1 ||
    requestedOutputTokens > 100_000
  ) {
    throw new Error("AI maxOutputTokens 必须是 1 到 100000 之间的整数。");
  }
  const estimatedInputTokens = Math.ceil(
    (options.systemPrompt.length + options.userPrompt.length) / 2,
  );
  const reservedTokens = requestedOutputTokens + estimatedInputTokens;
  const resources = await acquireAIResources({
    userKey,
    projectKey,
    task,
    reservedTokens,
  });
  let completed = false;

  try {
    const responseFormat = isReportJsonTask(task) && !options.disableJsonResponseFormat
      ? ({ type: "json_object" } as const)
      : undefined;
    const completion = await client.chat.completions.create(
      {
        model: config.model,
        messages: [
          {
            role: "system",
            content: `${options.systemPrompt}\n\n${UNTRUSTED_DATA_SYSTEM_POLICY}`,
          },
          {
            role: "user",
            content: options.userPrompt,
          },
        ],
        temperature: options.temperature ?? 0.2,
        max_tokens: options.maxOutputTokens ?? config.maxOutputTokens,
        seed: options.seed,
        ...(responseFormat ? { response_format: responseFormat } : {}),
      },
      {
        signal: controller.signal,
      },
    );
    const text = completion.choices[0]?.message?.content?.trim();

    if (!text) {
      throw new AIEmptyContentError("AI 返回内容为空。", {
        task,
        model: config.model,
        responseFormat: responseFormat?.type ?? null,
        finishReason: completion.choices[0]?.finish_reason ?? null,
      });
    }

    completed = true;
    recordAIProviderSuccess();
    await reconcileAIUsage({
      userKey,
      projectKey,
      task,
      dayKey: resources.dayKey,
      reservedTokens,
      actualTokens: completion.usage?.total_tokens ?? null,
    }).catch(() => undefined);
    return {
      text,
      model: config.model,
      raw: completion,
    };
  } catch (error) {
    if (error instanceof AIResourceLimitError) {
      throw error;
    }

    recordAIProviderFailure();
    const isTimeout = controller.signal.aborted;
    logAICall({
      task,
      model: config.model,
      startedAt,
      ok: false,
      error: isTimeout ? "timeout" : summarizeAILogError(error),
    });

    if (error instanceof AIEmptyContentError) {
      throw error;
    }

    if (isTimeout) {
      throw new Error(`AI 调用超时，已超过 ${config.timeoutMs}ms。`);
    }

    throw new Error(`AI 调用失败：${sanitizeAIError(error)}`);
  } finally {
    resources.release();
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
