import { AIResourceLimitError } from "@/lib/ai-resource-guard";

export function createAIResourceLimitResponse(error: unknown) {
  if (!(error instanceof AIResourceLimitError)) return null;

  const headers = error.retryable
    ? { "Retry-After": String(error.retryAfterSec) }
    : undefined;

  return Response.json(
    {
      status: "failed",
      error: error.message,
      message: error.message,
      code: error.code,
      retryAfterSec: error.retryAfterSec,
      retryable: error.retryable,
    },
    {
      status: error.retryable ? 429 : 422,
      headers,
    },
  );
}
