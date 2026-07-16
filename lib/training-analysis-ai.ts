import { AIEmptyContentError, callAI } from "@/lib/ai";
import type { ProjectAIContext } from "@/lib/project-context";
import { AIJsonParseError, parseAIJson } from "@/lib/json-utils";
import { renderPrompt } from "@/lib/prompt-renderer";
import { devError, devLog, devWarn } from "@/lib/dev-log";
import { writeDiagnosticEvent } from "@/lib/diagnostic-log";
import { getTrainingAnalysisGenerationContract } from "@/lib/training-analysis-version.mjs";
import {
  validateTrainingAnalysisResult,
  type TrainingAnalysisResult,
} from "@/lib/training-analysis-validator";
import {
  buildFallbackTrainingAnalysis,
  type TrainingAnalysisQuestionData,
} from "@/lib/training-analysis-fallback-builder";
import type { TrainingAnalysisFallbackReason } from "@/lib/training-analysis-fallback";

const GENERATION_CONTRACT = getTrainingAnalysisGenerationContract();
const DEBUG_RAW_AI_OUTPUT_LIMIT = 4_000;
const CONTEXT_EXPERT_COMMENT_LIMIT = 10;
const CONTEXT_HISTORICAL_QUESTION_LIMIT = 10;

type JsonParseFailureDetails = {
  message: string;
  originalLength?: number;
  extractedLength?: number;
  parsePosition?: number | null;
};

type EmptyContentDetails = {
  message: string;
  responseFormat: "json_object" | null;
  finishReason: string | null;
};

type RetryWithoutJsonModeDebug = {
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

type AnalysisJsonParseFailureDebug = TrainingAnalysisParseFailureDebug & {
  reason: "AI_STRUCTURED_OUTPUT_INVALID";
  finalFallbackReason: "STRUCTURED_OUTPUT_INVALID_AFTER_REPAIR";
  initialParseError: JsonParseFailureDetails;
  repairError: JsonParseFailureDetails;
};

type AnalysisEmptyContentDebug = TrainingAnalysisParseFailureDebug & {
  reason: "AI_EMPTY_CONTENT";
  finalFallbackReason: "RETRY_WITHOUT_JSON_MODE_EMPTY_CONTENT";
  callError: JsonParseFailureDetails;
  emptyContent: true;
};

class AnalysisJsonRepairError extends Error {
  debug: TrainingAnalysisParseFailureDebug;

  constructor(message: string, debug: TrainingAnalysisParseFailureDebug) {
    super(message);
    this.name = "AnalysisJsonRepairError";
    this.debug = debug;
  }
}

function truncateDebugText(text: string) {
  if (text.length <= DEBUG_RAW_AI_OUTPUT_LIMIT) {
    return text;
  }

  return `${text.slice(0, DEBUG_RAW_AI_OUTPUT_LIMIT)}...[truncated]`;
}

export function buildTrainingAnalysisPrompt(
  context: ProjectAIContext,
  template: string,
  input: {
    session: unknown;
    slideEvents: unknown;
    transcript: unknown;
    qaData: unknown;
    dynamicFollowupData: unknown;
  },
) {
  return renderPrompt(template, {
    session: input.session,
    slideEvents: input.slideEvents,
    transcript: input.transcript,
    qaData: input.qaData,
    dynamicFollowupData: input.dynamicFollowupData,
    project: context.project,
    files: context.files.map((file) => ({
      id: file.id,
      originalName: file.originalName,
      fileType: file.fileType,
      extractedText: file.extractedText,
      truncated: file.truncated,
    })),
    evaluationRule: context.evaluationRule,
    criteria: context.criteria,
    expertComments: context.expertComments.slice(0, CONTEXT_EXPERT_COMMENT_LIMIT),
    historicalQuestions: context.historicalQuestions.slice(
      0,
      CONTEXT_HISTORICAL_QUESTION_LIMIT,
    ),
  });
}

function getJsonParseFailureDetails(error: unknown): JsonParseFailureDetails {
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

function buildRepairPrompt(rawText: string, error: unknown) {
  const details = getJsonParseFailureDetails(error);
  return renderPrompt(
    [
      "请修复下面这段 AI 输出，使其成为一个合法 JSON 对象。",
      "只输出修复后的 JSON，不要输出 Markdown、代码块或解释文字。",
      "必须返回完整 JSON object，不能省略字段。",
      "输出结构必须符合 TrainingAnalysisResult。",
      "不能新增 schema 外字段。",
      "不要新增事实，不要补充转写文本中没有的表达。",
      "如果原文被截断或字段不完整，请在保持结构合法的前提下，用短句补齐未闭合的字符串、数组和对象。",
      "所有字符串必须闭合，所有数组和对象必须闭合。",
      "所有字符串必须是合法 JSON string，不能包含未转义换行或未转义双引号。",
      "如果某字段无法修复，用空字符串、空数组、false、null 或安全默认值补齐。",
      "必须保留原始内容中可恢复的信息。",
      "",
      "解析错误：{{parseError}}",
      "原始返回长度：{{originalLength}}",
      "截取后长度：{{extractedLength}}",
      "解析失败位置：{{parsePosition}}",
      "",
      "目标 JSON 结构：",
      "{",
      '  "overallScore": 0,',
      '  "summary": "",',
      '  "strengths": [],',
      '  "weaknesses": [],',
      '  "suggestions": [],',
      '  "onePageSummary": {',
      '    "conclusion": "",',
      '    "strongestPoint": "",',
      '    "biggestWeakness": "",',
      '    "nextTrainingFocus": "",',
      '    "readinessAdvice": ""',
      "  },",
      '  "diagnostics": {',
      '    "content": [],',
      '    "delivery": [],',
      '    "qa": []',
      "  },",
      '  "actionItems": [',
      "    {",
      '      "issue": "",',
      '      "whyItMatters": "",',
      '      "howToFix": "",',
      '      "sampleWording": ""',
      "    }",
      "  ],",
      '  "nextTrainingTasks": [],',
      '  "contentCoverage": [',
      "    {",
      '      "item": "",',
      '      "covered": "true",',
      '      "evidence": "",',
      '      "suggestion": ""',
      "    }",
      "  ],",
      '  "timing": {',
      '    "durationSec": 0,',
      '    "targetDurationSec": 540,',
      '    "assessment": "",',
      '    "opening": "",',
      '    "middle": "",',
      '    "ending": "",',
      '    "suggestion": ""',
      "  },",
      '  "slideSync": {',
      '    "slideEventCount": 0,',
      '    "pageCount": 0,',
      '    "assessment": "",',
      '    "frequentFlipRisk": "",',
      '    "longStayRisk": "",',
      '    "suggestion": ""',
      "  },",
      '  "riskQuestions": [],',
      '  "qaReviews": [],',
      '  "dynamicFollowupReview": null',
      "}",
      "",
      "需要修复的原始返回：",
      "{{rawText}}",
    ].join("\n"),
    {
      parseError: details.message,
      originalLength: details.originalLength ?? "unknown",
      extractedLength: details.extractedLength ?? "unknown",
      parsePosition: details.parsePosition ?? "unknown",
      rawText,
    },
  );
}

function formatJsonParseFailure(details: JsonParseFailureDetails) {
  return JSON.stringify({
    message: details.message,
    originalLength: details.originalLength ?? null,
    extractedLength: details.extractedLength ?? null,
    parsePosition: details.parsePosition ?? null,
  });
}

function buildAnalysisParseFailureDebug(input: {
  rawText: string;
  initialError: unknown;
  repairError: unknown;
  jsonModeEmptyContent?: EmptyContentDetails | null;
  retryWithoutJsonMode?: RetryWithoutJsonModeDebug | null;
}): AnalysisJsonParseFailureDebug {
  return {
    reason: "AI_STRUCTURED_OUTPUT_INVALID",
    finalFallbackReason: "STRUCTURED_OUTPUT_INVALID_AFTER_REPAIR",
    generatedAt: new Date().toISOString(),
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

function getEmptyContentDetails(error: AIEmptyContentError): EmptyContentDetails {
  return {
    message: error.message,
    responseFormat: error.responseFormat,
    finishReason: error.finishReason,
  };
}

function buildAnalysisEmptyContentDebug(input: {
  error: AIEmptyContentError;
  jsonModeEmptyContent?: EmptyContentDetails | null;
}): AnalysisEmptyContentDebug {
  return {
    reason: "AI_EMPTY_CONTENT",
    finalFallbackReason: "RETRY_WITHOUT_JSON_MODE_EMPTY_CONTENT",
    generatedAt: new Date().toISOString(),
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

async function parseAnalysisJsonWithRepair(
  rawText: string,
  debugContext: {
    sessionId: string;
    jsonModeEmptyContent?: EmptyContentDetails | null;
    retryWithoutJsonMode?: RetryWithoutJsonModeDebug | null;
  },
) {
  try {
    return validateTrainingAnalysisResult(parseAIJson(rawText));
  } catch (error) {
    devError(
      `路演表现分析结构化输出校验失败，开始一次修复重试。${formatJsonParseFailure(
        getJsonParseFailureDetails(error),
      )}`,
    );

    try {
      const repairResult = await callAI({
        task: "pitchAnalysis",
        systemPrompt:
          "你是严格的 JSON 修复器。只输出合法 JSON，不输出 Markdown 或解释。",
        userPrompt: buildRepairPrompt(rawText, error),
        temperature: 0,
        maxOutputTokens: GENERATION_CONTRACT.repairMaxOutputTokens,
      });
      const repairedAnalysis = validateTrainingAnalysisResult(
        parseAIJson(repairResult.text),
      );
      devLog("路演表现分析 JSON 修复重试成功。");
      return repairedAnalysis;
    } catch (repairError) {
      const debug = buildAnalysisParseFailureDebug({
        rawText,
        initialError: error,
        repairError,
        jsonModeEmptyContent: debugContext.jsonModeEmptyContent,
        retryWithoutJsonMode: debugContext.retryWithoutJsonMode,
      });
      devError(
        `路演表现分析 JSON 修复重试失败。${formatJsonParseFailure(
          debug.repairError,
        )}`,
      );
      void writeDiagnosticEvent({
        type: "REPORT_ERROR",
        message: "Pitch analysis structured output validation and repair failed",
        meta: {
          sessionId: debugContext.sessionId,
          initialError: debug.initialParseError.message,
          repairError: debug.repairError.message,
          rawAiOutputLength: debug.rawAiOutputLength,
          initialParsePosition: debug.initialParseError.parsePosition ?? null,
          repairParsePosition: debug.repairError.parsePosition ?? null,
        },
      });
      throw new AnalysisJsonRepairError(
        "路演表现分析结构化输出校验失败，修复重试后仍不符合报告 Schema。",
        debug,
      );
    }
  }
}

export function buildStoredTrainingAnalysisResult(
  analysis: TrainingAnalysisResult,
  debug: TrainingAnalysisParseFailureDebug | null,
) {
  if (!debug) {
    return JSON.stringify(analysis, null, 2);
  }

  return JSON.stringify({ ...analysis, _debug: debug }, null, 2);
}

export async function generateTrainingAnalysisFromAI(input: {
  sessionId: string;
  userPrompt: string;
  durationSec: number;
  pageCount: number | null;
  slideEventCount: number;
  transcriptMissing: boolean;
  qaData: TrainingAnalysisQuestionData[];
  dynamicFollowupData: TrainingAnalysisQuestionData | null;
}): Promise<{
  analysis: TrainingAnalysisResult;
  debug: TrainingAnalysisParseFailureDebug | null;
  fallbackReason: TrainingAnalysisFallbackReason | null;
}> {
  let debug: TrainingAnalysisParseFailureDebug | null = null;
  let aiResult: Awaited<ReturnType<typeof callAI>> | null = null;
  let jsonModeEmptyContent: EmptyContentDetails | null = null;
  let retryWithoutJsonMode: RetryWithoutJsonModeDebug | null = null;

  try {
    aiResult = await callAI({
      task: "pitchAnalysis",
      systemPrompt:
        "你是严格遵守 JSON 输出约束的专业路演训练教练。只输出合法 JSON，不输出 Markdown 或额外解释。",
      userPrompt: input.userPrompt,
      temperature: 0.2,
      maxOutputTokens: GENERATION_CONTRACT.maxOutputTokens,
    });
  } catch (aiCallError) {
    if (!(aiCallError instanceof AIEmptyContentError)) {
      throw aiCallError;
    }

    jsonModeEmptyContent = getEmptyContentDetails(aiCallError);
    devWarn(
      `路演表现分析 JSON mode 返回空内容，开始普通模式重试。${JSON.stringify({
        sessionId: input.sessionId,
        responseFormat: jsonModeEmptyContent.responseFormat,
        finishReason: jsonModeEmptyContent.finishReason,
      })}`,
    );
    void writeDiagnosticEvent({
      type: "REPORT_ERROR",
      message:
        "Pitch analysis JSON mode returned empty content; retrying without response_format",
      meta: {
        responseFormat: jsonModeEmptyContent.responseFormat,
        finishReason: jsonModeEmptyContent.finishReason,
      },
    });

    try {
      aiResult = await callAI({
        task: "pitchAnalysis",
        systemPrompt:
          "你是严格遵守 JSON 输出约束的专业路演训练教练。只输出合法 JSON，不输出 Markdown 或额外解释。",
        userPrompt: input.userPrompt,
        temperature: 0.2,
        maxOutputTokens: GENERATION_CONTRACT.maxOutputTokens,
        disableJsonResponseFormat: true,
      });
      retryWithoutJsonMode = {
        attempted: true,
        rawAiOutputLength: aiResult.text.length,
        rawAiOutput: truncateDebugText(aiResult.text),
        emptyContent: false,
        finishReason: null,
      };
    } catch (retryError) {
      if (!(retryError instanceof AIEmptyContentError)) {
        throw retryError;
      }

      debug = buildAnalysisEmptyContentDebug({
        error: retryError,
        jsonModeEmptyContent,
      });
      devError(
        `路演表现分析普通模式重试仍返回空内容，使用降级 fallback。${JSON.stringify({
          sessionId: input.sessionId,
          finishReason: retryError.finishReason,
        })}`,
      );
      void writeDiagnosticEvent({
        type: "REPORT_ERROR",
        message: "Pitch analysis retry without response_format returned empty content",
        meta: { finishReason: retryError.finishReason },
      });
    }
  }

  if (!aiResult) {
    return {
      analysis: buildFallbackTrainingAnalysis({
        durationSec: input.durationSec,
        pageCount: input.pageCount,
        slideEventCount: input.slideEventCount,
        transcriptMissing: input.transcriptMissing,
        qaData: input.qaData,
        dynamicFollowupData: input.dynamicFollowupData,
        failureReason: "AI_EMPTY_CONTENT",
      }),
      debug,
      fallbackReason: "AI_EMPTY_CONTENT",
    };
  }

  try {
    return {
      analysis: await parseAnalysisJsonWithRepair(aiResult.text, {
        sessionId: input.sessionId,
        jsonModeEmptyContent,
        retryWithoutJsonMode,
      }),
      debug: null,
      fallbackReason: null,
    };
  } catch (analysisParseError) {
    if (analysisParseError instanceof AnalysisJsonRepairError) {
      debug = analysisParseError.debug;
    }
    devError(
      `路演表现分析 JSON 修复后仍失败，使用降级 fallback。${JSON.stringify({
        sessionId: input.sessionId,
        error:
          analysisParseError instanceof Error
            ? analysisParseError.message
            : String(analysisParseError),
        rawAiOutputLength: debug?.rawAiOutputLength ?? null,
      })}`,
    );
    const analysis = buildFallbackTrainingAnalysis({
      durationSec: input.durationSec,
      pageCount: input.pageCount,
      slideEventCount: input.slideEventCount,
      transcriptMissing: input.transcriptMissing,
      qaData: input.qaData,
      dynamicFollowupData: input.dynamicFollowupData,
      failureReason: "STRUCTURED_OUTPUT_INVALID",
    });
    devLog("[analysis:generation] fallback analysis created", {
      sessionId: input.sessionId,
      qaReviewCount: analysis.qaReviews?.length ?? 0,
      hasDynamicFollowupReview: analysis.dynamicFollowupReview !== null,
    });
    return {
      analysis,
      debug,
      fallbackReason: "STRUCTURED_OUTPUT_INVALID",
    };
  }
}
