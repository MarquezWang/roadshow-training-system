import {
  TranscribeBusinessError,
  TranscribeEmptyResultError,
} from "@/lib/transcribe-error";

const TRANSCRIBE_RETRY_DELAYS_MS = [5_000, 30_000] as const;

export const TEMPORARY_TRANSCRIBE_ERROR_MESSAGE =
  "转写服务暂时不可用，系统将自动重试。";

export class TranscribeHttpError extends Error {
  status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = "TranscribeHttpError";
    this.status = status;
  }
}

export function getErrorSummary(error: unknown) {
  const message =
    error instanceof TranscribeBusinessError
      ? error.rawMessage || error.userMessage
      : error instanceof Error
        ? error.message
        : String(error);

  return message
    .replace(/sk-[A-Za-z0-9_-]+/g, "[redacted]")
    .replace(/Bearer\s+[A-Za-z0-9._-]+/g, "Bearer [redacted]")
    .slice(0, 500);
}

export function isRetryableTranscribeError(error: unknown) {
  const summary = getErrorSummary(error).toLowerCase();
  const isBusinessError = error instanceof TranscribeBusinessError;

  if (error instanceof TranscribeEmptyResultError) {
    return false;
  }

  const nonRetryableIndicators = [
    "api key",
    "unsupported",
    "not supported",
    "ffmpeg",
    "file does not exist",
    "audio file does not exist",
  ];

  if (nonRetryableIndicators.some((indicator) => summary.includes(indicator))) {
    return false;
  }

  const retryableIndicators = [
    "fetch failed",
    "network",
    "timeout",
    "timed out",
    "econnreset",
    "etimedout",
    "socket hang up",
    "temporarily unavailable",
    "service unavailable",
    "bad gateway",
    "gateway timeout",
    "internal server error",
    "http 500",
    "http 502",
    "http 503",
    "http 504",
    "5xx",
    "empty",
    "为空",
    "orderresult",
  ];

  if (isBusinessError) {
    return retryableIndicators.some((indicator) =>
      summary.includes(indicator),
    );
  }

  return retryableIndicators.some((indicator) => summary.includes(indicator));
}

export function buildTranscriptionFailurePlan(
  error: unknown,
  attempt: number,
  maxAttempts: number,
) {
  const retryable = isRetryableTranscribeError(error);
  const businessMessage =
    error instanceof TranscribeBusinessError ? error.userMessage : null;
  const errorSummary = getErrorSummary(error);
  const willRetry = retryable && attempt < maxAttempts;
  const errorMessage = businessMessage !== null
    ? businessMessage
    : willRetry
      ? TEMPORARY_TRANSCRIBE_ERROR_MESSAGE
      : retryable
        ? "转写服务多次尝试仍失败，请稍后手工重试。"
        : errorSummary;
  const retryDelayMs = TRANSCRIBE_RETRY_DELAYS_MS[attempt - 1] ?? 30_000;

  return {
    retryable,
    businessMessage,
    errorSummary,
    willRetry,
    errorMessage,
    retryDelayMs,
  };
}
