import { callAI } from "@/lib/ai";
import { AIResourceLimitError } from "@/lib/ai-resource-guard";
import { devError, devLog } from "@/lib/dev-log";
import { writeDiagnosticEvent } from "@/lib/diagnostic-log";
import { parseAIJson } from "@/lib/json-utils";
import {
  validateTrainingAnalysisResult,
  type TrainingAnalysisResult,
} from "@/lib/training-analysis-validator";

import { TRAINING_ANALYSIS_GENERATION_CONTRACT } from "./contract";
import {
  buildAnalysisParseFailureDebug,
  formatJsonParseFailure,
  getJsonParseFailureDetails,
} from "./debug";
import { buildRepairPrompt } from "./prompts";
import type {
  EmptyContentDetails,
  RetryWithoutJsonModeDebug,
  TrainingAnalysisParseFailureDebug,
} from "./types";

export class AnalysisJsonRepairError extends Error {
  debug: TrainingAnalysisParseFailureDebug;

  constructor(message: string, debug: TrainingAnalysisParseFailureDebug) {
    super(message);
    this.name = "AnalysisJsonRepairError";
    this.debug = debug;
  }
}

type AnalysisParserDependencies = {
  callAI: typeof callAI;
  parseAIJson: typeof parseAIJson;
  validateTrainingAnalysisResult: typeof validateTrainingAnalysisResult;
  writeDiagnosticEvent: typeof writeDiagnosticEvent;
  now: () => Date;
};

const DEFAULT_ANALYSIS_PARSER_DEPENDENCIES: AnalysisParserDependencies = {
  callAI,
  parseAIJson,
  validateTrainingAnalysisResult,
  writeDiagnosticEvent,
  now: () => new Date(),
};

export async function parseAnalysisJsonWithRepair(
  rawText: string,
  debugContext: {
    sessionId: string;
    userId?: string;
    projectId?: string;
    jsonModeEmptyContent?: EmptyContentDetails | null;
    retryWithoutJsonMode?: RetryWithoutJsonModeDebug | null;
  },
  dependencies: AnalysisParserDependencies = DEFAULT_ANALYSIS_PARSER_DEPENDENCIES,
): Promise<TrainingAnalysisResult> {
  try {
    return dependencies.validateTrainingAnalysisResult(
      dependencies.parseAIJson(rawText),
    );
  } catch (error) {
    devError(
      `路演表现分析结构化输出校验失败，开始一次修复重试。${formatJsonParseFailure(
        getJsonParseFailureDetails(error),
      )}`,
    );

    try {
      const repairResult = await dependencies.callAI({
        task: "pitchAnalysis",
        userId: debugContext.userId,
        projectId: debugContext.projectId,
        systemPrompt:
          "你是严格的 JSON 修复器。只输出合法 JSON，不输出 Markdown 或解释。",
        userPrompt: buildRepairPrompt(rawText, error),
        temperature: 0,
        maxOutputTokens:
          TRAINING_ANALYSIS_GENERATION_CONTRACT.repairMaxOutputTokens,
      });
      const repairedAnalysis = dependencies.validateTrainingAnalysisResult(
        dependencies.parseAIJson(repairResult.text),
      );
      devLog("路演表现分析 JSON 修复重试成功。");
      return repairedAnalysis;
    } catch (repairError) {
      if (repairError instanceof AIResourceLimitError) throw repairError;

      const debug = buildAnalysisParseFailureDebug(
        {
          rawText,
          initialError: error,
          repairError,
          jsonModeEmptyContent: debugContext.jsonModeEmptyContent,
          retryWithoutJsonMode: debugContext.retryWithoutJsonMode,
        },
        dependencies.now(),
      );
      devError(
        `路演表现分析 JSON 修复重试失败。${formatJsonParseFailure(
          debug.repairError,
        )}`,
      );
      void dependencies.writeDiagnosticEvent({
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
