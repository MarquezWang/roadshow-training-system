import { AIEmptyContentError, callAI } from "@/lib/ai";
import { devError, devLog, devWarn } from "@/lib/dev-log";
import { writeDiagnosticEvent } from "@/lib/diagnostic-log";
import type { TrainingAnalysisFallbackReason } from "@/lib/training-analysis-fallback";
import {
  buildFallbackTrainingAnalysis,
  type TrainingAnalysisQuestionData,
} from "@/lib/training-analysis-fallback-builder";
import type { TrainingAnalysisResult } from "@/lib/training-analysis-validator";

import { TRAINING_ANALYSIS_GENERATION_CONTRACT } from "./contract";
import {
  buildAnalysisEmptyContentDebug,
  getEmptyContentDetails,
  truncateDebugText,
} from "./debug";
import {
  AnalysisJsonRepairError,
  parseAnalysisJsonWithRepair,
} from "./parser";
import type {
  EmptyContentDetails,
  RetryWithoutJsonModeDebug,
  TrainingAnalysisParseFailureDebug,
} from "./types";

const ANALYSIS_SYSTEM_PROMPT =
  "你是严格遵守 JSON 输出约束的专业路演训练教练。只输出合法 JSON，不输出 Markdown 或额外解释。";

export type GenerateTrainingAnalysisInput = {
  sessionId: string;
  userId: string;
  projectId: string;
  userPrompt: string;
  durationSec: number;
  pageCount: number | null;
  slideEventCount: number;
  transcriptMissing: boolean;
  qaData: TrainingAnalysisQuestionData[];
  dynamicFollowupData: TrainingAnalysisQuestionData | null;
};

type TrainingAnalysisGenerationDependencies = {
  callAI: typeof callAI;
  parseAnalysisJsonWithRepair: typeof parseAnalysisJsonWithRepair;
  buildFallbackTrainingAnalysis: typeof buildFallbackTrainingAnalysis;
  writeDiagnosticEvent: typeof writeDiagnosticEvent;
  now: () => Date;
};

const DEFAULT_TRAINING_ANALYSIS_GENERATION_DEPENDENCIES: TrainingAnalysisGenerationDependencies = {
  callAI,
  parseAnalysisJsonWithRepair,
  buildFallbackTrainingAnalysis,
  writeDiagnosticEvent,
  now: () => new Date(),
};

export async function generateTrainingAnalysisFromAI(
  input: GenerateTrainingAnalysisInput,
  dependencies: TrainingAnalysisGenerationDependencies = DEFAULT_TRAINING_ANALYSIS_GENERATION_DEPENDENCIES,
): Promise<{
  analysis: TrainingAnalysisResult;
  debug: TrainingAnalysisParseFailureDebug | null;
  fallbackReason: TrainingAnalysisFallbackReason | null;
}> {
  let debug: TrainingAnalysisParseFailureDebug | null = null;
  let aiResult: Awaited<ReturnType<typeof callAI>> | null = null;
  let jsonModeEmptyContent: EmptyContentDetails | null = null;
  let retryWithoutJsonMode: RetryWithoutJsonModeDebug | null = null;

  try {
    aiResult = await dependencies.callAI({
      task: "pitchAnalysis",
      userId: input.userId,
      projectId: input.projectId,
      systemPrompt: ANALYSIS_SYSTEM_PROMPT,
      userPrompt: input.userPrompt,
      temperature: 0.2,
      maxOutputTokens: TRAINING_ANALYSIS_GENERATION_CONTRACT.maxOutputTokens,
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
    void dependencies.writeDiagnosticEvent({
      type: "REPORT_ERROR",
      message:
        "Pitch analysis JSON mode returned empty content; retrying without response_format",
      meta: {
        responseFormat: jsonModeEmptyContent.responseFormat,
        finishReason: jsonModeEmptyContent.finishReason,
      },
    });

    try {
      aiResult = await dependencies.callAI({
        task: "pitchAnalysis",
        userId: input.userId,
        projectId: input.projectId,
        systemPrompt: ANALYSIS_SYSTEM_PROMPT,
        userPrompt: input.userPrompt,
        temperature: 0.2,
        maxOutputTokens: TRAINING_ANALYSIS_GENERATION_CONTRACT.maxOutputTokens,
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

      debug = buildAnalysisEmptyContentDebug(
        {
          error: retryError,
          jsonModeEmptyContent,
        },
        dependencies.now(),
      );
      devError(
        `路演表现分析普通模式重试仍返回空内容，使用降级 fallback。${JSON.stringify({
          sessionId: input.sessionId,
          finishReason: retryError.finishReason,
        })}`,
      );
      void dependencies.writeDiagnosticEvent({
        type: "REPORT_ERROR",
        message: "Pitch analysis retry without response_format returned empty content",
        meta: { finishReason: retryError.finishReason },
      });
    }
  }

  if (!aiResult) {
    return {
      analysis: dependencies.buildFallbackTrainingAnalysis({
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
      analysis: await dependencies.parseAnalysisJsonWithRepair(aiResult.text, {
        sessionId: input.sessionId,
        userId: input.userId,
        projectId: input.projectId,
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
    const analysis = dependencies.buildFallbackTrainingAnalysis({
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
