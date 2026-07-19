export function getUtcDailyQuotaWindow(now = new Date()) {
  const timestamp = now.getTime();
  if (!Number.isFinite(timestamp)) {
    throw new Error("AI quota window requires a valid date.");
  }

  const nextUtcDay = Date.UTC(
    now.getUTCFullYear(),
    now.getUTCMonth(),
    now.getUTCDate() + 1,
  );

  return {
    dayKey: now.toISOString().slice(0, 10),
    retryAfterSec: Math.max(
      1,
      Math.ceil((nextUtcDay - timestamp) / 1_000),
    ),
  };
}
