export type JsonParseFailureDetails = {
  message: string;
  originalLength?: number;
  extractedLength?: number;
  parsePosition?: number | null;
};

export type EmptyContentDetails = {
  message: string;
  responseFormat: "json_object" | null;
  finishReason: string | null;
};

export type RetryWithoutJsonModeDebug = {
  attempted: true;
  rawAiOutputLength: number;
  rawAiOutput: string;
  emptyContent: boolean;
  finishReason: string | null;
};

export type TrainingAnalysisParseFailureDebug = {
  reason: "AI_STRUCTURED_OUTPUT_INVALID" | "AI_EMPTY_CONTENT";
  finalFallbackReason:
    | "STRUCTURED_OUTPUT_INVALID_AFTER_REPAIR"
    | "RETRY_WITHOUT_JSON_MODE_EMPTY_CONTENT";
  generatedAt: string;
  initialParseError?: JsonParseFailureDetails;
  repairError?: JsonParseFailureDetails;
  callError?: JsonParseFailureDetails;
  rawAiOutputLength: number;
  rawAiOutput: string;
  emptyContent?: true;
  responseFormat?: "json_object" | null;
  finishReason?: string | null;
  jsonModeEmptyContent?: EmptyContentDetails;
  retryWithoutJsonMode?: RetryWithoutJsonModeDebug;
};

export type AnalysisJsonParseFailureDebug =
  TrainingAnalysisParseFailureDebug & {
    reason: "AI_STRUCTURED_OUTPUT_INVALID";
    finalFallbackReason: "STRUCTURED_OUTPUT_INVALID_AFTER_REPAIR";
    initialParseError: JsonParseFailureDetails;
    repairError: JsonParseFailureDetails;
  };

export type AnalysisEmptyContentDebug = TrainingAnalysisParseFailureDebug & {
  reason: "AI_EMPTY_CONTENT";
  finalFallbackReason: "RETRY_WITHOUT_JSON_MODE_EMPTY_CONTENT";
  callError: JsonParseFailureDetails;
  emptyContent: true;
};
