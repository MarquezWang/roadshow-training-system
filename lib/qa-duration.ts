export const MAX_CLIENT_QA_DURATION_FALLBACK_SEC = 2 * 60 * 60;

function readClientFallback(value: unknown) {
  if (
    typeof value !== "number" ||
    !Number.isInteger(value) ||
    value < 0 ||
    value > MAX_CLIENT_QA_DURATION_FALLBACK_SEC
  ) {
    return null;
  }

  return value;
}

export function resolveQaDurationSec(
  startedAt: Date | null,
  endedAt: Date,
  clientFallback: unknown,
) {
  if (startedAt) {
    return Math.max(
      0,
      Math.round((endedAt.getTime() - startedAt.getTime()) / 1_000),
    );
  }

  return readClientFallback(clientFallback);
}
