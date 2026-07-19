export const AI_RUNTIME_INTEGER_SETTINGS = Object.freeze([
  Object.freeze({
    name: "AI_TIMEOUT_MS",
    fallback: 60_000,
    minimum: 1_000,
    maximum: 5 * 60_000,
  }),
  Object.freeze({
    name: "AI_MAX_OUTPUT_TOKENS",
    fallback: 3_000,
    minimum: 100,
    maximum: 100_000,
  }),
]);

export function readBoundedIntegerSetting(env, setting) {
  const raw = env[setting.name]?.trim();
  if (!raw) return setting.fallback;

  const value = Number(raw);
  if (
    !Number.isInteger(value) ||
    value < setting.minimum ||
    value > setting.maximum
  ) {
    throw new Error(
      `${setting.name} 必须是 ${setting.minimum} 到 ${setting.maximum} 之间的整数。`,
    );
  }

  return value;
}

export function getAIRuntimeLimits(env = process.env) {
  const [timeoutSetting, maxOutputTokensSetting] =
    AI_RUNTIME_INTEGER_SETTINGS;

  return {
    timeoutMs: readBoundedIntegerSetting(env, timeoutSetting),
    maxOutputTokens: readBoundedIntegerSetting(
      env,
      maxOutputTokensSetting,
    ),
  };
}
