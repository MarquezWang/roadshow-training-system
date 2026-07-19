import { readBoundedIntegerSetting } from "./ai-runtime-config.mjs";

export const AI_MAX_RESERVED_TOKENS_PER_REQUEST = 500_000;

const AI_QUOTA_SETTINGS = Object.freeze({
  requestsPerMinute: Object.freeze({
    name: "AI_USER_REQUESTS_PER_MINUTE",
    fallback: 20,
    minimum: 1,
    maximum: 600,
  }),
  dailyRequests: Object.freeze({
    name: "AI_USER_DAILY_REQUESTS",
    fallback: 500,
    minimum: 1,
    maximum: 100_000,
  }),
  dailyTokens: Object.freeze({
    name: "AI_USER_DAILY_TOKENS",
    fallback: 500_000,
    minimum: 1_000,
    maximum: 100_000_000,
  }),
  userConcurrency: Object.freeze({
    name: "AI_USER_MAX_CONCURRENT",
    fallback: 3,
    minimum: 1,
    maximum: 50,
  }),
  scopeConcurrency: Object.freeze({
    name: "AI_SCOPE_MAX_CONCURRENT",
    fallback: 1,
    minimum: 1,
    maximum: 10,
  }),
  globalConcurrency: Object.freeze({
    name: "AI_GLOBAL_MAX_CONCURRENT",
    fallback: 10,
    minimum: 1,
    maximum: 200,
  }),
  providerFailureThreshold: Object.freeze({
    name: "AI_PROVIDER_FAILURE_THRESHOLD",
    fallback: 3,
    minimum: 1,
    maximum: 20,
  }),
  providerBackoffMs: Object.freeze({
    name: "AI_PROVIDER_BACKOFF_MS",
    fallback: 30_000,
    minimum: 1_000,
    maximum: 10 * 60_000,
  }),
});

export const AI_QUOTA_INTEGER_SETTINGS = Object.freeze(
  Object.values(AI_QUOTA_SETTINGS),
);

export function getAIQuotaConfig(env = process.env) {
  return Object.fromEntries(
    Object.entries(AI_QUOTA_SETTINGS).map(([key, setting]) => [
      key,
      readBoundedIntegerSetting(env, setting),
    ]),
  );
}

export function assertAIDailyBudgetSupportsMaximumRequest(
  env = process.env,
) {
  const config = getAIQuotaConfig(env);

  if (config.dailyTokens < AI_MAX_RESERVED_TOKENS_PER_REQUEST) {
    throw new Error(
      `AI_USER_DAILY_TOKENS 必须至少为 ${AI_MAX_RESERVED_TOKENS_PER_REQUEST}，` +
        "以容纳系统允许的最大单次 AI Token 预占量。",
    );
  }

  return {
    dailyTokens: config.dailyTokens,
    maxReservedTokensPerRequest: AI_MAX_RESERVED_TOKENS_PER_REQUEST,
  };
}
