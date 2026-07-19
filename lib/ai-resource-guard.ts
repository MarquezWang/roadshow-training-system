import type { AiModelTask } from "@/lib/ai-models";
import { getUtcDailyQuotaWindow } from "@/lib/ai-quota-window.mjs";
import {
  AI_MAX_RESERVED_TOKENS_PER_REQUEST,
  getAIQuotaConfig,
} from "@/lib/ai-resource-config.mjs";
import { prisma } from "@/lib/prisma";

type GuardState = {
  recentRequests: Map<string, number[]>;
  activeByUser: Map<string, number>;
  activeByScope: Map<string, number>;
  globalActive: number;
  consecutiveProviderFailures: number;
  providerBackoffUntil: number;
};

const globalForGuard = globalThis as typeof globalThis & {
  aiResourceGuardState?: GuardState;
};

const state: GuardState =
  globalForGuard.aiResourceGuardState ??
  (globalForGuard.aiResourceGuardState = {
    recentRequests: new Map<string, number[]>(),
    activeByUser: new Map<string, number>(),
    activeByScope: new Map<string, number>(),
    globalActive: 0,
    consecutiveProviderFailures: 0,
    providerBackoffUntil: 0,
  });

type AIResourceLimitCode =
  | "AI_RATE_LIMITED"
  | "AI_DAILY_BUDGET_EXHAUSTED"
  | "AI_CONCURRENCY_LIMITED"
  | "AI_PROVIDER_UNAVAILABLE"
  | "AI_REQUEST_EXCEEDS_DAILY_BUDGET"
  | "AI_REQUEST_TOO_LARGE";

const NON_RETRYABLE_RESOURCE_LIMIT_CODES = new Set<AIResourceLimitCode>([
  "AI_REQUEST_EXCEEDS_DAILY_BUDGET",
  "AI_REQUEST_TOO_LARGE",
]);

export class AIResourceLimitError extends Error {
  readonly retryAfterSec: number;
  readonly code: AIResourceLimitCode;
  readonly retryable: boolean;

  constructor(
    message: string,
    retryAfterSec: number,
    code: AIResourceLimitCode,
  ) {
    super(message);
    this.name = "AIResourceLimitError";
    this.retryAfterSec = retryAfterSec;
    this.code = code;
    this.retryable = !NON_RETRYABLE_RESOURCE_LIMIT_CODES.has(code);
  }
}

function increment(map: Map<string, number>, key: string) {
  map.set(key, (map.get(key) ?? 0) + 1);
}

function decrement(map: Map<string, number>, key: string) {
  const next = (map.get(key) ?? 1) - 1;
  if (next <= 0) map.delete(key);
  else map.set(key, next);
}

function assertRequestReservationFitsBudget(
  reservedTokens: number,
  dailyTokens: number,
) {
  if (reservedTokens > AI_MAX_RESERVED_TOKENS_PER_REQUEST) {
    throw new AIResourceLimitError(
      `单次 AI 请求预占 ${reservedTokens} Token，超过系统单次上限 ${AI_MAX_RESERVED_TOKENS_PER_REQUEST}。`,
      0,
      "AI_REQUEST_TOO_LARGE",
    );
  }
  if (reservedTokens > dailyTokens) {
    throw new AIResourceLimitError(
      `单次 AI 请求预占 ${reservedTokens} Token，超过每日预算 ${dailyTokens}。`,
      0,
      "AI_REQUEST_EXCEEDS_DAILY_BUDGET",
    );
  }
}

async function reserveDailyBudget(params: {
  userKey: string;
  projectKey: string;
  task: AiModelTask;
  reservedTokens: number;
}) {
  const config = getAIQuotaConfig(process.env);
  const { dayKey, retryAfterSec } = getUtcDailyQuotaWindow();

  await prisma.$transaction(async (transaction) => {
    const usage = await transaction.aiQuotaUsage.aggregate({
      where: { userKey: params.userKey, dayKey },
      _sum: { requestCount: true, tokenCount: true },
    });
    const requestCount = usage._sum.requestCount ?? 0;
    const tokenCount = usage._sum.tokenCount ?? 0;

    if (requestCount >= config.dailyRequests) {
      throw new AIResourceLimitError(
        "今日 AI 请求次数已达到上限。",
        retryAfterSec,
        "AI_DAILY_BUDGET_EXHAUSTED",
      );
    }
    if (tokenCount + params.reservedTokens > config.dailyTokens) {
      throw new AIResourceLimitError(
        "今日 AI Token 预算已用尽。",
        retryAfterSec,
        "AI_DAILY_BUDGET_EXHAUSTED",
      );
    }

    await transaction.aiQuotaUsage.upsert({
      where: {
        userKey_projectKey_task_dayKey: {
          userKey: params.userKey,
          projectKey: params.projectKey,
          task: params.task,
          dayKey,
        },
      },
      create: {
        userKey: params.userKey,
        projectKey: params.projectKey,
        task: params.task,
        dayKey,
        requestCount: 1,
        tokenCount: params.reservedTokens,
      },
      update: {
        requestCount: { increment: 1 },
        tokenCount: { increment: params.reservedTokens },
      },
    });
  });

  return dayKey;
}

export async function acquireAIResources(params: {
  userKey: string;
  projectKey: string;
  task: AiModelTask;
  reservedTokens: number;
}) {
  const config = getAIQuotaConfig(process.env);
  assertRequestReservationFitsBudget(
    params.reservedTokens,
    config.dailyTokens,
  );
  const now = Date.now();
  if (state.providerBackoffUntil > now) {
    throw new AIResourceLimitError(
      "AI 服务暂时熔断，请稍后重试。",
      Math.max(1, Math.ceil((state.providerBackoffUntil - now) / 1_000)),
      "AI_PROVIDER_UNAVAILABLE",
    );
  }

  const recent = (state.recentRequests.get(params.userKey) ?? []).filter(
    (timestamp) => now - timestamp < 60_000,
  );
  if (recent.length >= config.requestsPerMinute) {
    throw new AIResourceLimitError(
      "AI 请求过于频繁，请稍后重试。",
      Math.max(1, Math.ceil((60_000 - (now - recent[0])) / 1_000)),
      "AI_RATE_LIMITED",
    );
  }

  const scopeKey = `${params.userKey}:${params.projectKey}:${params.task}`;
  if ((state.activeByUser.get(params.userKey) ?? 0) >= config.userConcurrency) {
    throw new AIResourceLimitError(
      "当前用户的 AI 并发任务已达到上限。",
      5,
      "AI_CONCURRENCY_LIMITED",
    );
  }
  if ((state.activeByScope.get(scopeKey) ?? 0) >= config.scopeConcurrency) {
    throw new AIResourceLimitError(
      "同一项目的同类 AI 任务正在处理中。",
      5,
      "AI_CONCURRENCY_LIMITED",
    );
  }
  if (state.globalActive >= config.globalConcurrency) {
    throw new AIResourceLimitError(
      "AI 服务当前繁忙，请稍后重试。",
      5,
      "AI_CONCURRENCY_LIMITED",
    );
  }

  recent.push(now);
  state.recentRequests.set(params.userKey, recent);
  increment(state.activeByUser, params.userKey);
  increment(state.activeByScope, scopeKey);
  state.globalActive += 1;

  let dayKey: string;
  try {
    dayKey = await reserveDailyBudget(params);
  } catch (error) {
    decrement(state.activeByUser, params.userKey);
    decrement(state.activeByScope, scopeKey);
    state.globalActive = Math.max(0, state.globalActive - 1);
    throw error;
  }

  let released = false;
  return {
    dayKey,
    release() {
      if (released) return;
      released = true;
      decrement(state.activeByUser, params.userKey);
      decrement(state.activeByScope, scopeKey);
      state.globalActive = Math.max(0, state.globalActive - 1);
    },
  };
}

export async function reconcileAIUsage(params: {
  userKey: string;
  projectKey: string;
  task: AiModelTask;
  dayKey: string;
  reservedTokens: number;
  actualTokens: number | null;
}) {
  if (params.actualTokens === null) return;
  const delta = params.actualTokens - params.reservedTokens;
  if (delta === 0) return;

  await prisma.aiQuotaUsage.update({
    where: {
      userKey_projectKey_task_dayKey: {
        userKey: params.userKey,
        projectKey: params.projectKey,
        task: params.task,
        dayKey: params.dayKey,
      },
    },
    data: { tokenCount: { increment: delta } },
  });
}

export function recordAIProviderSuccess() {
  state.consecutiveProviderFailures = 0;
  state.providerBackoffUntil = 0;
}

export function recordAIProviderFailure() {
  const config = getAIQuotaConfig(process.env);
  state.consecutiveProviderFailures += 1;
  if (state.consecutiveProviderFailures >= config.providerFailureThreshold) {
    state.providerBackoffUntil = Date.now() + config.providerBackoffMs;
  }
}
