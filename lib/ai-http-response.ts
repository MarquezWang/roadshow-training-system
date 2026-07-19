import { AIResourceLimitError } from "@/lib/ai-resource-guard";

export function createAIResourceLimitResponse(error: unknown) {
  if (!(error instanceof AIResourceLimitError)) return null;

  return Response.json(
    {
      status: "failed",
      error: error.message,
      message: error.message,
      code: error.code,
      retryAfterSec: error.retryAfterSec,
    },
    {
      status: 429,
      headers: {
        "Retry-After": String(error.retryAfterSec),
      },
    },
  );
}
