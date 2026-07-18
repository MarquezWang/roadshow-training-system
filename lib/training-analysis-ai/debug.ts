import { AIEmptyContentError } from "@/lib/ai";
import { AIJsonParseError } from "@/lib/json-utils";

import type {
  AnalysisEmptyContentDebug,
  AnalysisJsonParseFailureDebug,
  EmptyContentDetails,
  JsonParseFailureDetails,
  RetryWithoutJsonModeDebug,
} from "./types";

const DEBUG_RAW_AI_OUTPUT_LIMIT = 4_000;

export function truncateDebugText(text: string) {
  if (text.length <= DEBUG_RAW_AI_OUTPUT_LIMIT) {
    return text;
  }

  return `${text.slice(0, DEBUG_RAW_AI_OUTPUT_LIMIT)}...[truncated]`;
}

export function getJsonParseFailureDetails(
  error: unknown,
): JsonParseFailureDetails {
  if (error instanceof AIJsonParseError) {
    return {
      message: error.message,
      originalLength: error.originalLength,
      extractedLength: error.extractedLength,
      parsePosition: error.parsePosition,
    };
  }

  return {
    message: error instanceof Error ? error.message : String(error),
  };
}

export function formatJsonParseFailure(details: JsonParseFailureDetails) {
  return JSON.stringify({
    message: details.message,
    originalLength: details.originalLength ?? null,
    extractedLength: details.extractedLength ?? null,
    parsePosition: details.parsePosition ?? null,
  });
}

export function getEmptyContentDetails(
  error: AIEmptyContentError,
): EmptyContentDetails {
  return {
    message: error.message,
    responseFormat: error.responseFormat,
    finishReason: error.finishReason,
  };
}

export function buildAnalysisParseFailureDebug(
  input: {
    rawText: string;
    initialError: unknown;
    repairError: unknown;
    jsonModeEmptyContent?: EmptyContentDetails | null;
    retryWithoutJsonMode?: RetryWithoutJsonModeDebug | null;
  },
  generatedAt = new Date(),
): AnalysisJsonParseFailureDebug {
  return {
    reason: "AI_STRUCTURED_OUTPUT_INVALID",
    finalFallbackReason: "STRUCTURED_OUTPUT_INVALID_AFTER_REPAIR",
    generatedAt: generatedAt.toISOString(),
    initialParseError: getJsonParseFailureDetails(input.initialError),
    repairError: getJsonParseFailureDetails(input.repairError),
    rawAiOutputLength: input.rawText.length,
    rawAiOutput: truncateDebugText(input.rawText),
    ...(input.jsonModeEmptyContent
      ? { jsonModeEmptyContent: input.jsonModeEmptyContent }
      : {}),
    ...(input.retryWithoutJsonMode
      ? { retryWithoutJsonMode: input.retryWithoutJsonMode }
      : {}),
  };
}

export function buildAnalysisEmptyContentDebug(
  input: {
    error: AIEmptyContentError;
    jsonModeEmptyContent?: EmptyContentDetails | null;
  },
  generatedAt = new Date(),
): AnalysisEmptyContentDebug {
  return {
    reason: "AI_EMPTY_CONTENT",
    finalFallbackReason: "RETRY_WITHOUT_JSON_MODE_EMPTY_CONTENT",
    generatedAt: generatedAt.toISOString(),
    callError: { message: input.error.message },
    rawAiOutputLength: 0,
    rawAiOutput: "",
    emptyContent: true,
    responseFormat: input.error.responseFormat,
    finishReason: input.error.finishReason,
    ...(input.jsonModeEmptyContent
      ? { jsonModeEmptyContent: input.jsonModeEmptyContent }
      : {}),
    retryWithoutJsonMode: {
      attempted: true,
      rawAiOutputLength: 0,
      rawAiOutput: "",
      emptyContent: true,
      finishReason: input.error.finishReason,
    },
  };
}
