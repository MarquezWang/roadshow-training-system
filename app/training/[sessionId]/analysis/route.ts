import { NextRequest, NextResponse } from "next/server";
import { AIEmptyContentError, callAI } from "@/lib/ai";
import {
  buildProjectAIContext,
  parseProjectAIContextSnapshot,
  ProjectContextNotFoundError,
  type ProjectAIContext,
} from "@/lib/project-context";
import { AIJsonParseError, parseAIJson } from "@/lib/json-utils";
import { loadPromptTemplate } from "@/lib/prompt-loader";
import { renderPrompt } from "@/lib/prompt-renderer";
import { devLog, devWarn, devError } from "@/lib/dev-log";
import { writeDiagnosticEvent } from "@/lib/diagnostic-log";
import { prisma } from "@/lib/prisma";
import { isSessionOwnedByCurrentUser } from "@/lib/auth-server";
import {
  calculateTrainingAnalysisInputHash,
  reconcileTrainingAnalysisInputVersion,
} from "@/lib/training-analysis-input";
import { acquireAsyncJob, releaseAsyncJob } from "@/lib/async-job";
import { isFallbackTrainingAnalysis } from "@/lib/training-analysis-fallback";
import { publishTrainingAnalysis } from "@/lib/training-analysis-publication.mjs";
import { getTrainingAnalysisGenerationContract } from "@/lib/training-analysis-version.mjs";
import {
  validateTrainingAnalysisResult,
  type TrainingAnalysisResult,
  type QaReview,
  type DynamicFollowupReview,
} from "@/lib/training-analysis-validator";

type TrainingAnalysisRouteContext = Readonly<{
  params: Promise<{
    sessionId: string;
  }>;
}>;

type TrainingAnalysisRecord = NonNullable<
  Awaited<ReturnType<typeof findLatestAnalysis>>
>;

const PITCH_ANALYSIS_TYPE = "PITCH";
const ANALYSIS_GENERATION_CONTRACT = getTrainingAnalysisGenerationContract();
const PITCH_ANALYSIS_MAX_OUTPUT_TOKENS =
  ANALYSIS_GENERATION_CONTRACT.maxOutputTokens;
const PITCH_ANALYSIS_REPAIR_MAX_OUTPUT_TOKENS =
  ANALYSIS_GENERATION_CONTRACT.repairMaxOutputTokens;
const PROCESSING_ANALYSIS_TIMEOUT_MS = 5 * 60 * 1_000;
const TRANSCRIPT_WAIT_TIMEOUT_MS = 90_000;
const CONTEXT_EXPERT_COMMENT_LIMIT = 10;
const CONTEXT_HISTORICAL_QUESTION_LIMIT = 10;
const FALLBACK_ANALYSIS_SCORE = 15;
const DEBUG_RAW_AI_OUTPUT_LIMIT = 4_000;
const analysisJobKey = (sessionId: string) => `training-analysis:${sessionId}`;
const COVERAGE_ITEMS = [
  "项目背景",
  "痛点问题",
  "技术方案",
  "核心创新",
  "应用场景",
  "市场空间",
  "商业模式",
  "团队能力",
  "融资/合作需求",
] as const;

type AnalysisQuestionData = {
  questionId: string;
  orderIndex: number;
  questionType: string | null;
  source: string;
  questionText: string;
  answerDurationSec: number | null;
  answerText: string | null;
  transcribeText: string | null;
  transcribeStatus: string | null;
  transcribeFailed: boolean;
  transcribePending: boolean;
  transcribeNote: string | null;
};

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

type AnalysisParseFailureDebug = {
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
type AnalysisJsonParseFailureDebug = AnalysisParseFailureDebug & {
  reason: "AI_STRUCTURED_OUTPUT_INVALID";
  finalFallbackReason: "STRUCTURED_OUTPUT_INVALID_AFTER_REPAIR";
  initialParseError: JsonParseFailureDetails;
  repairError: JsonParseFailureDetails;
};
type AnalysisEmptyContentDebug = AnalysisParseFailureDebug & {
  reason: "AI_EMPTY_CONTENT";
  finalFallbackReason: "RETRY_WITHOUT_JSON_MODE_EMPTY_CONTENT";
  callError: JsonParseFailureDetails;
  emptyContent: true;
};

class AnalysisJsonRepairError extends Error {
  debug: AnalysisParseFailureDebug;

  constructor(message: string, debug: AnalysisParseFailureDebug) {
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

function parseStoredJson<T>(value: string, fallback: T): T {
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

function serializeAnalysis(analysis: TrainingAnalysisRecord) {
  const rawResult = parseStoredJson<Record<string, unknown>>(
    analysis.rawResultJson,
    {},
  );

  return {
    id: analysis.id,
    sessionId: analysis.sessionId,
    projectId: analysis.projectId,
    transcriptId: analysis.transcriptId,
    status: analysis.status,
    analysisType: analysis.analysisType,
    durationSec: analysis.durationSec,
    pageCount: analysis.pageCount,
    slideEventCount: analysis.slideEventCount,
    overallScore: analysis.overallScore,
    isFallbackReport: isFallbackTrainingAnalysis(analysis),
    summary: analysis.summary,
    strengths: parseStoredJson<string[]>(analysis.strengthsJson, []),
    weaknesses: parseStoredJson<string[]>(analysis.weaknessesJson, []),
    suggestions: parseStoredJson<string[]>(analysis.suggestionsJson, []),
    onePageSummary: rawResult.onePageSummary ?? null,
    diagnostics: rawResult.diagnostics ?? null,
    actionItems: Array.isArray(rawResult.actionItems)
      ? rawResult.actionItems
      : [],
    nextTrainingTasks: Array.isArray(rawResult.nextTrainingTasks)
      ? rawResult.nextTrainingTasks
      : [],
    coverage: parseStoredJson<TrainingAnalysisResult["contentCoverage"]>(
      analysis.coverageJson,
      [],
    ),
    contentCoverage: parseStoredJson<TrainingAnalysisResult["contentCoverage"]>(
      analysis.coverageJson,
      [],
    ),
    timing: parseStoredJson<Record<string, unknown>>(analysis.timingJson, {}),
    slideSync: parseStoredJson<Record<string, unknown>>(
      analysis.slideSyncJson,
      {},
    ),
    riskQuestions: parseStoredJson<string[]>(analysis.riskQuestionsJson, []),
    qaReviews: (Array.isArray(rawResult.qaReviews)
      ? rawResult.qaReviews
      : []) as QaReview[],
    dynamicFollowupReview:
      rawResult.dynamicFollowupReview === null ||
      rawResult.dynamicFollowupReview === undefined
        ? null
        : (rawResult.dynamicFollowupReview as DynamicFollowupReview),
    rawResult,
    errorMessage: analysis.errorMessage,
    inputHash: analysis.inputHash,
    promptVersion: analysis.promptVersion,
    schemaVersion: analysis.schemaVersion,
    modelVersion: analysis.modelVersion,
    ruleVersion: analysis.ruleVersion,
    createdAt: analysis.createdAt.toISOString(),
    updatedAt: analysis.updatedAt.toISOString(),
  };
}

function isProcessingAnalysisFresh(analysis: TrainingAnalysisRecord) {
  return (
    analysis.status === "PROCESSING" &&
    Date.now() - analysis.updatedAt.getTime() < PROCESSING_ANALYSIS_TIMEOUT_MS
  );
}

async function findLatestAnalysis(sessionId: string) {
  return prisma.trainingAnalysis.findFirst({
    where: {
      sessionId,
      analysisType: PITCH_ANALYSIS_TYPE,
    },
    orderBy: {
      createdAt: "desc",
    },
  });
}

function compactContext(context: ProjectAIContext): ProjectAIContext {
  return {
    ...context,
    expertComments: context.expertComments.slice(0, CONTEXT_EXPERT_COMMENT_LIMIT),
    historicalQuestions: context.historicalQuestions.slice(
      0,
      CONTEXT_HISTORICAL_QUESTION_LIMIT,
    ),
  };
}

function isDynamicFollowupQuestion(question: {
  source?: string | null;
  questionType?: string | null;
}) {
  return (
    question.source === "DYNAMIC_FOLLOWUP" ||
    question.questionType === "FOLLOWUP"
  );
}

function hasEnteredAnswer(answer: {
  startedAt?: Date | null;
  endedAt?: Date | null;
  answerText?: string | null;
  recording?: { id: string } | null;
} | null) {
  return Boolean(
    answer?.startedAt ||
      answer?.endedAt ||
      answer?.recording ||
      answer?.answerText?.trim(),
  );
}

function hasTranscriptWaitTimedOut(
  startedAt: Date | null | undefined,
  nowMs: number,
) {
  return startedAt
    ? nowMs - startedAt.getTime() > TRANSCRIPT_WAIT_TIMEOUT_MS
    : false;
}

function summarizeAnswer(question: AnalysisQuestionData) {
  const answerText =
    question.transcribeText?.trim() || question.answerText?.trim();

  if (answerText) {
    return answerText.length > 120 ? `${answerText.slice(0, 120)}...` : answerText;
  }

  if (question.transcribePending) {
    return "回答转写尚未完成，当前降级报告无法准确概括回答内容。";
  }

  if (question.transcribeFailed) {
    return "回答转写失败，当前降级报告无法准确概括回答内容。";
  }

  return "未检测到可用于复盘的有效回答文本。";
}

function buildFallbackQaReview(question: AnalysisQuestionData): QaReview {
  const hasAnswerText = Boolean(
    question.transcribeText?.trim() || question.answerText?.trim(),
  );

  return {
    questionId: question.questionId,
    questionIndex: question.orderIndex,
    dimension: "OTHER",
    question: question.questionText,
    judgeIntent: "评委意图暂未能由 AI 结构化结果稳定解析，当前为降级复盘。",
    answerSummary: summarizeAnswer(question),
    responseQuality: hasAnswerText ? "PARTIAL" : "WEAK",
    responseQualityLabel: hasAnswerText
      ? "降级复盘，需人工复核"
      : "回答依据不足",
    missingPoints: [
      "结构化报告生成失败，当前无法完整判断回答覆盖情况",
      "建议补充数据、案例或验证依据来支撑回答",
    ],
    evidenceUse: hasAnswerText
      ? "检测到回答文本，但证据使用情况需人工复核。"
      : "未能提取到有效回答证据。",
    improvementAdvice:
      "建议围绕评委问题先给出直接结论，再补充关键事实、数据或案例支撑。",
    betterAnswerOutline: [
      "先正面回答问题核心",
      "补充项目相关数据、案例或验证结果",
      "总结对落地、风险或商业化的影响",
    ],
  };
}

function buildFallbackAnalysis(input: {
  durationSec: number;
  pageCount: number | null;
  slideEventCount: number;
  transcriptMissing: boolean;
  qaData: AnalysisQuestionData[];
  dynamicFollowupData: AnalysisQuestionData | null;
  failureReason?: "STRUCTURED_OUTPUT_INVALID" | "AI_EMPTY_CONTENT" | "NO_ANALYZABLE_TEXT";
}) {
  const fallbackSummary =
    input.failureReason === "AI_EMPTY_CONTENT"
      ? "报告生成时 AI 未返回有效内容，系统已基于可用转写和答辩数据生成基础报告，并保留排查信息。"
      : input.failureReason === "NO_ANALYZABLE_TEXT"
        ? "本轮训练缺少可分析的转写或回答文本，系统已根据录音元信息生成基础报告。"
        : "报告生成时 AI 结构化输出不符合报告 Schema，修复重试失败后系统已生成基础报告，并保留排查信息。";
  const fallbackAnalysis = {
    overallScore: FALLBACK_ANALYSIS_SCORE,
    summary: fallbackSummary,
    strengths: [],
    weaknesses: [
      "结构化报告生成失败，当前报告为降级版本，细节判断可能不完整。",
      input.transcriptMissing
        ? "路演转写缺失或不可用，无法充分评估项目表达。"
        : "当前降级报告未能完整抽取路演中的证据覆盖情况。",
      "答辩复盘仅基于已有问题、回答文本和转写状态生成，建议人工复核关键判断。",
    ],
    suggestions: [
      "本次报告为降级版本，建议先结合录音回放人工复核关键判断。",
      "下一轮路演中请用数字、客户案例、测试结果或合同订单支撑关键结论。",
      "答辩时先直接回应评委问题，再补充证据和下一步计划。",
      "如系统持续生成降级报告，请由管理员查看诊断信息并调整分析配置。",
    ],
    contentCoverage: COVERAGE_ITEMS.map((item) => ({
      item,
      covered: "false",
      evidence: input.transcriptMissing
        ? "路演转写缺失，无法确认覆盖情况。"
        : "降级报告未能稳定解析该维度证据。",
      suggestion: `建议补充${item}相关的可验证事实、数据或案例。`,
    })),
    timing: {
      durationSec: input.durationSec,
      targetDurationSec: 540,
      assessment: "当前为降级报告，仅保留基础时长信息。",
      opening: "降级报告未能细分开场节奏。",
      middle: "降级报告未能细分中段表达节奏。",
      ending: "降级报告未能细分结尾收束情况。",
      suggestion: "建议按背景、方案、验证、商业化和需求拆分路演时间。",
    },
    slideSync: {
      slideEventCount: input.slideEventCount,
      pageCount: input.pageCount ?? 0,
      assessment: "当前为降级报告，仅保留基础翻页信息。",
      frequentFlipRisk: "降级报告未能判断是否频繁翻页。",
      longStayRisk: "降级报告未能判断是否长时间停留。",
      suggestion: "建议按核心章节控制翻页节奏，避免讲述与页面信息脱节。",
    },
    riskQuestions: [
      "请说明项目当前最关键的验证指标是什么，以及已有数据是否达标？",
      "如果客户转化或落地进度低于预期，你们准备如何调整？",
      "项目在技术实现、交付和运营过程中最大的风险是什么？",
      "后续融资或合作需求将如何对应到明确的里程碑？",
    ],
    qaReviews: input.qaData.map(buildFallbackQaReview),
    dynamicFollowupReview: input.dynamicFollowupData
      ? {
          questionId: input.dynamicFollowupData.questionId,
          question: input.dynamicFollowupData.questionText,
          answerSummary: summarizeAnswer(input.dynamicFollowupData),
          targetWeakness:
            "动态追问表现未能由 AI 结构化结果稳定解析，当前为降级复盘。",
          evidenceSupplement:
            "请人工复核该回答是否补充了数据、案例或验证依据。",
          improvementAdvice:
            "建议围绕动态追问的核心点补充直接结论、关键证据和下一步计划。",
        }
      : null,
  };

  return validateTrainingAnalysisResult(fallbackAnalysis);
}

function buildAnalysisPrompt(
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
    expertComments: context.expertComments,
    historicalQuestions: context.historicalQuestions,
  });
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

async function findCurrentAnalysis(sessionId: string) {
  const session = await prisma.trainingSession.findUnique({
    where: { id: sessionId },
    select: {
      currentAnalysis: true,
    },
  });

  if (
    session?.currentAnalysis?.status === "COMPLETED" &&
    session.currentAnalysis.analysisType === PITCH_ANALYSIS_TYPE
  ) {
    return session.currentAnalysis;
  }

  return prisma.trainingAnalysis.findFirst({
    where: {
      sessionId,
      analysisType: PITCH_ANALYSIS_TYPE,
      status: "COMPLETED",
    },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
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

function formatJsonParseFailure(details: JsonParseFailureDetails) {
  return JSON.stringify({
    message: details.message,
    originalLength: details.originalLength ?? null,
    extractedLength: details.extractedLength ?? null,
    parsePosition: details.parsePosition ?? null,
  });
}

function buildAnalysisParseFailureDebug({
  rawText,
  initialError,
  repairError,
  jsonModeEmptyContent,
  retryWithoutJsonMode,
}: {
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
    initialParseError: getJsonParseFailureDetails(initialError),
    repairError: getJsonParseFailureDetails(repairError),
    rawAiOutputLength: rawText.length,
    rawAiOutput: truncateDebugText(rawText),
    ...(jsonModeEmptyContent ? { jsonModeEmptyContent } : {}),
    ...(retryWithoutJsonMode ? { retryWithoutJsonMode } : {}),
  };
}

function getEmptyContentDetails(
  error: AIEmptyContentError,
): EmptyContentDetails {
  return {
    message: error.message,
    responseFormat: error.responseFormat,
    finishReason: error.finishReason,
  };
}

function buildAnalysisEmptyContentDebug({
  error,
  jsonModeEmptyContent,
}: {
  error: AIEmptyContentError;
  jsonModeEmptyContent?: EmptyContentDetails | null;
}): AnalysisEmptyContentDebug {
  return {
    reason: "AI_EMPTY_CONTENT",
    finalFallbackReason: "RETRY_WITHOUT_JSON_MODE_EMPTY_CONTENT",
    generatedAt: new Date().toISOString(),
    callError: {
      message: error.message,
    },
    rawAiOutputLength: 0,
    rawAiOutput: truncateDebugText(""),
    emptyContent: true,
    responseFormat: error.responseFormat,
    finishReason: error.finishReason,
    ...(jsonModeEmptyContent ? { jsonModeEmptyContent } : {}),
    retryWithoutJsonMode: {
      attempted: true,
      rawAiOutputLength: 0,
      rawAiOutput: truncateDebugText(""),
      emptyContent: true,
      finishReason: error.finishReason,
    },
  };
}

function buildStoredAnalysisResult(
  analysisJson: TrainingAnalysisResult,
  debug: AnalysisParseFailureDebug | null,
) {
  if (!debug) {
    return JSON.stringify(analysisJson, null, 2);
  }

  return JSON.stringify(
    {
      ...analysisJson,
      _debug: debug,
    },
    null,
    2,
  );
}

async function parseAnalysisJsonWithRepair(
  rawText: string,
  debugContext?: {
    sessionId?: string;
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
        maxOutputTokens: PITCH_ANALYSIS_REPAIR_MAX_OUTPUT_TOKENS,
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
        jsonModeEmptyContent: debugContext?.jsonModeEmptyContent,
        retryWithoutJsonMode: debugContext?.retryWithoutJsonMode,
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
          sessionId: debugContext?.sessionId ?? null,
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

function getFriendlyErrorMessage(error: unknown) {
  const message =
    error instanceof Error ? error.message : "路演表现分析生成失败。";

  if (
    message.toLowerCase().includes("timeout") ||
    message.includes("超时") ||
    message.includes("60000ms")
  ) {
    return "路演表现分析生成超时：当前转写文本或项目上下文较长，或模型响应较慢。请提高 AI_TIMEOUT_MS，或减少纳入 AI 分析的材料长度后重试。";
  }

  return message;
}

async function createOrUpdateProcessingAnalysis(input: {
  sessionId: string;
  projectId: string;
  transcriptId: string | null;
  durationSec: number;
  pageCount: number | null;
  slideEventCount: number;
  transcriptMissing: boolean;
  inputHash: string;
}) {
  const baseData = {
    projectId: input.projectId,
    transcriptId: input.transcriptId,
    status: "PROCESSING" as const,
    analysisType: PITCH_ANALYSIS_TYPE,
    durationSec: input.durationSec,
    pageCount: input.pageCount,
    slideEventCount: input.slideEventCount,
    overallScore: null,
    summary: input.transcriptMissing ? "路演自动转写缺失或失败，分析基于项目材料与答辩数据降级生成。" : "",
    strengthsJson: "[]",
    weaknessesJson: "[]",
    suggestionsJson: "[]",
    coverageJson: "[]",
    timingJson: "{}",
    slideSyncJson: "{}",
    riskQuestionsJson: "[]",
    rawResultJson: "{}",
    errorMessage: null,
    inputHash: input.inputHash,
    promptVersion: ANALYSIS_GENERATION_CONTRACT.promptVersion,
    schemaVersion: ANALYSIS_GENERATION_CONTRACT.schemaVersion,
    modelVersion: ANALYSIS_GENERATION_CONTRACT.modelVersion,
    ruleVersion: ANALYSIS_GENERATION_CONTRACT.ruleVersion,
  };

  return prisma.trainingAnalysis.create({
    data: {
      ...baseData,
      sessionId: input.sessionId,
    },
  });
}

export async function GET(
  _request: NextRequest,
  context: TrainingAnalysisRouteContext,
) {
  const { sessionId } = await context.params;
  if (!(await isSessionOwnedByCurrentUser(sessionId))) {
    return NextResponse.json({ error: "Session not found" }, { status: 404 });
  }
  const analysis = await findCurrentAnalysis(sessionId);

  // 获取 QA transcript 状态计数，供前端轮询使用
  const qaTranscripts = await prisma.trainingTranscript.findMany({
    where: {
      sessionId,
      recording: { phase: "QA" },
    },
    select: {
      id: true,
      status: true,
      completedAt: true,
      updatedAt: true,
    },
  });

  const qaTranscriptStatus = {
    total: qaTranscripts.length,
    pendingCount: qaTranscripts.filter((t) => t.status === "PENDING" || t.status === "PROCESSING").length,
    completedCount: qaTranscripts.filter((t) => t.status === "COMPLETED").length,
    failedCount: qaTranscripts.filter((t) => t.status === "FAILED").length,
    canGenerate: qaTranscripts.length > 0 && qaTranscripts.every((t) => t.status === "COMPLETED" || t.status === "FAILED"),
  };

  return NextResponse.json({
    analysis: analysis ? serializeAnalysis(analysis) : null,
    qaTranscriptStatus,
  });
}

export async function POST(
  request: NextRequest,
  context: TrainingAnalysisRouteContext,
) {
  const { sessionId } = await context.params;
  const forceRegeneration = request.nextUrl.searchParams.get("force") === "true";
  if (!(await isSessionOwnedByCurrentUser(sessionId))) {
    return NextResponse.json({ error: "Session not found" }, { status: 404 });
  }

  let processingAnalysisId: string | null = null;
  let hasGenerationLock = false;
  let analysisJobOwnerToken: string | null = null;
  let analysisJobError: string | null = null;

  try {
    const session = await prisma.trainingSession.findUnique({
      where: {
        id: sessionId,
      },
      include: {
        slideEvents: {
          orderBy: {
            createdAt: "asc",
          },
          select: {
            eventType: true,
            pageIndex: true,
            elapsedSec: true,
            createdAt: true,
          },
        },
        transcripts: {
          where: {
            status: "COMPLETED",
            text: {
              not: "",
            },
            recording: {
              phase: "PITCH",
            },
          },
          orderBy: {
            updatedAt: "desc",
          },
          take: 1,
          select: {
            id: true,
            text: true,
            source: true,
            language: true,
            completedAt: true,
            updatedAt: true,
          },
        },
        trainingQuestions: {
          orderBy: {
            orderIndex: "asc",
          },
          select: {
            id: true,
            orderIndex: true,
            questionText: true,
            questionType: true,
            source: true,
            answer: {
              select: {
                id: true,
                startedAt: true,
                durationSec: true,
                answerText: true,
                endedAt: true,
                recording: {
                  select: {
                    id: true,
                    transcript: {
                      select: {
                        text: true,
                        status: true,
                      },
                    },
                  },
                },
              },
            },
          },
        },
      },
    });

    if (!session) {
      return NextResponse.json({ error: "训练场次不存在。" }, { status: 404 });
    }
    const analysisInputHash = await calculateTrainingAnalysisInputHash(sessionId);
    if (!analysisInputHash) {
      return NextResponse.json({ error: "训练场次不存在。" }, { status: 404 });
    }

    const acquiredAnalysisJob = await acquireAsyncJob({
      jobKey: analysisJobKey(sessionId),
      jobType: "TRAINING_ANALYSIS",
      resourceId: sessionId,
      leaseMs: 15 * 60_000,
    });
    if (!acquiredAnalysisJob) {
      const activeAnalysis = await findLatestAnalysis(sessionId);

      if (activeAnalysis && isProcessingAnalysisFresh(activeAnalysis)) {
        return NextResponse.json({
          analysis: serializeAnalysis(activeAnalysis),
        });
      }

      return NextResponse.json(
        {
          error: "路演表现分析正在生成中，请稍后再试。",
          reason: "analysis_generation_in_progress",
          analysisProcessing: true,
        },
        { status: 409 },
      );
    }

    analysisJobOwnerToken = acquiredAnalysisJob.ownerToken;
    hasGenerationLock = true;

    // 防止重复生成：检查是否已有处理中或已完成的 analysis
    const existingAnalysis = await findLatestAnalysis(sessionId);
    if (existingAnalysis) {
      if (existingAnalysis.status === "PROCESSING") {
        if (isProcessingAnalysisFresh(existingAnalysis)) {
          return NextResponse.json({
            analysis: serializeAnalysis(existingAnalysis),
          });
        }

        devLog("[analysis:POST] stale processing analysis detected, taking over", {
          sessionId,
          analysisId: existingAnalysis.id,
          processingAgeMs: Date.now() - existingAnalysis.updatedAt.getTime(),
          timeoutMs: PROCESSING_ANALYSIS_TIMEOUT_MS,
        });
      }
      if (existingAnalysis.status === "COMPLETED") {
        const staleCheck = await reconcileTrainingAnalysisInputVersion(
          sessionId,
          existingAnalysis,
        );
        if (!staleCheck.stale && !forceRegeneration) {
          return NextResponse.json({
            analysis: {
              ...serializeAnalysis(existingAnalysis),
              inputHash:
                staleCheck.currentInputHash ?? existingAnalysis.inputHash,
            },
          });
        }
        // stale 或用户明确要求重试降级报告时，创建新版本并保留旧报告。
        devLog("[analysis:POST] regenerating completed analysis", {
          sessionId,
          forceRegeneration,
          staleReason: staleCheck.reason,
          analysisUpdatedAt: existingAnalysis.updatedAt.toISOString(),
        });
        // 继续执行，不 return
      }
    }

    if (
      !["PITCH_ENDED", "QA_READY", "QA_ENDED", "REPORT_READY", "FINISHED"].includes(
        session.status,
      ) ||
      !session.pitchEndedAt
    ) {
      return NextResponse.json(
        { error: "请先结束路演后再分析。" },
        { status: 400 },
      );
    }

    const transcript = session.transcripts[0] ?? null;
    const transcriptMissing = !transcript?.text.trim();
    const nowMs = Date.now();

    // 如果 Pitch 转写仍在进行中，未超时前返回等待；超时后继续降级生成。
    if (transcriptMissing) {
      const pitchRecording = await prisma.trainingRecording.findFirst({
        where: {
          sessionId,
          phase: "PITCH",
        },
        orderBy: {
          createdAt: "desc",
        },
        select: {
          id: true,
          createdAt: true,
          updatedAt: true,
          transcript: {
            select: { id: true, status: true, updatedAt: true },
          },
        },
      });
      const pitchWaitStartedAt =
        pitchRecording?.transcript?.updatedAt ??
        pitchRecording?.updatedAt ??
        pitchRecording?.createdAt ??
        session.pitchEndedAt;
      const pitchCanDegrade = hasTranscriptWaitTimedOut(
        pitchWaitStartedAt,
        nowMs,
      );
      const pitchTranscriptWaiting = Boolean(
        pitchRecording &&
          (!pitchRecording.transcript ||
            ["PENDING", "PROCESSING"].includes(
              pitchRecording.transcript.status,
            )),
      );

      if (pitchTranscriptWaiting && !pitchCanDegrade) {
        return NextResponse.json(
          {
            error: "路演转写正在进行中，请稍后再试。",
            transcriptProcessing: true,
            transcriptStatus: pitchRecording?.transcript?.status ?? "MISSING",
          },
          { status: 409 },
        );
      }
    }

    // 检查 QA 转写状态：有 PENDING/PROCESSING 的 QA 转录时，返回等待状态
    // 等待计时从 qaEndedAt 开始，或从最后一条 QA 录音的结束时间开始
    const qaEndedTime = session.qaEndedAt?.getTime();
    // 如果 qaEndedAt 不存在（例如 QA 未结束），使用最后一条 QA 录音的时间
    const latestQaAnswerTime = session.trainingQuestions
      .filter((q) => hasEnteredAnswer(q.answer) && q.answer?.endedAt)
      .map((q) => q.answer!.endedAt!.getTime())
      .sort((a, b) => b - a)[0];
    const qaBaselineTime = qaEndedTime ?? latestQaAnswerTime;

    // 只有在有明确基线时间且已等待超过 90 秒，才允许降级生成
    const canDegrade = qaBaselineTime
      ? nowMs - qaBaselineTime > TRANSCRIPT_WAIT_TIMEOUT_MS
      : false;
    const enteredQaRecordingIds = session.trainingQuestions
      .filter((q) => hasEnteredAnswer(q.answer) && q.answer?.recording?.id)
      .map((q) => q.answer!.recording!.id);

    if (!canDegrade && enteredQaRecordingIds.length > 0) {
      const pendingQaRecordings = await prisma.trainingRecording.findMany({
        where: {
          sessionId,
          id: {
            in: enteredQaRecordingIds,
          },
          phase: "QA",
        },
        select: {
          id: true,
          transcript: { select: { status: true } },
        },
      });
      const pendingCount = pendingQaRecordings.filter(
        (recording) =>
          !recording.transcript ||
          ["PENDING", "PROCESSING"].includes(recording.transcript.status),
      ).length;

      if (pendingCount > 0) {
        return NextResponse.json(
          {
            error: "答辩回答转写尚未完成，请稍后重试。",
            qaTranscriptsProcessing: true,
            pendingCount,
          },
          { status: 409 },
        );
      }
    }

    const durationSec =
      session.pitchDurationSec ??
      Math.max(
        0,
        Math.round(
          (session.pitchEndedAt.getTime() -
            (session.pitchStartedAt?.getTime() ?? session.pitchEndedAt.getTime())) /
            1000,
        ),
      );
    const pageIndexes = session.slideEvents
      .map((event) => event.pageIndex)
      .filter((pageIndex): pageIndex is number => pageIndex !== null);
    const pageCount =
      pageIndexes.length > 0 ? new Set(pageIndexes).size : null;
    const processingAnalysis = await createOrUpdateProcessingAnalysis({
      sessionId: session.id,
      projectId: session.projectId,
      transcriptId: transcript?.id ?? null,
      durationSec,
      pageCount,
      slideEventCount: session.slideEvents.length,
      transcriptMissing,
      inputHash: analysisInputHash,
    });

    processingAnalysisId = processingAnalysis.id;

    const enteredQuestions = session.trainingQuestions.filter((q) =>
      hasEnteredAnswer(q.answer),
    );
    const baseEnteredQuestions = enteredQuestions.filter(
      (q) => !isDynamicFollowupQuestion(q),
    );
    const dynamicFollowupQuestion =
      enteredQuestions.find((q) => isDynamicFollowupQuestion(q)) ?? null;

    const mapQuestionToAnalysisData = (
      q: (typeof enteredQuestions)[number],
    ): AnalysisQuestionData => {
      const transcribeStatus = q.answer?.recording?.transcript?.status ?? null;
      const transcribeText = q.answer?.recording?.transcript?.text ?? null;
      const isPendingOrProcessing =
        transcribeStatus === "PENDING" || transcribeStatus === "PROCESSING";
      return {
        questionId: q.id,
        orderIndex: q.orderIndex,
        questionType: q.questionType,
        source: q.source,
        questionText: q.questionText,
        answerDurationSec: q.answer?.durationSec ?? null,
        answerText: q.answer?.answerText ?? null,
        transcribeText,
        transcribeStatus,
        transcribeFailed: transcribeStatus === "FAILED",
        transcribePending: isPendingOrProcessing,
        transcribeNote:
          transcribeStatus === "FAILED"
            ? "该题转写失败，分析依据可能不足，请基于答题时长和项目材料进行有限分析。"
            : isPendingOrProcessing
              ? "该题转写超时未完成，分析依据不足，请基于项目材料和答题时长进行有限分析。"
              : null,
      };
    };

    const qaData = baseEnteredQuestions.map(mapQuestionToAnalysisData);
    const dynamicFollowupData = dynamicFollowupQuestion
      ? mapQuestionToAnalysisData(dynamicFollowupQuestion)
      : null;
    const hasAnalyzableText =
      !transcriptMissing ||
      qaData.some(
        (question) =>
          Boolean(question.answerText?.trim()) ||
          Boolean(question.transcribeText?.trim()),
      ) ||
      Boolean(dynamicFollowupData?.answerText?.trim()) ||
      Boolean(dynamicFollowupData?.transcribeText?.trim());

    if (!hasAnalyzableText) {
      const fallbackAnalysis = buildFallbackAnalysis({
        durationSec,
        pageCount,
        slideEventCount: session.slideEvents.length,
        transcriptMissing,
        qaData,
        dynamicFollowupData,
        failureReason: "NO_ANALYZABLE_TEXT",
      });
      const latestInputHash = await calculateTrainingAnalysisInputHash(sessionId);
      if (!latestInputHash || latestInputHash !== analysisInputHash) {
        await prisma.trainingAnalysis.update({
          where: { id: processingAnalysis.id },
          data: {
            status: "FAILED",
            errorMessage: "报告生成期间训练输入发生变化，请重新生成。",
          },
        });
        processingAnalysisId = null;
        analysisJobError = "analysis input changed while generating";
        return NextResponse.json(
          {
            error: "报告生成期间训练输入发生变化，请重新生成。",
            reason: "analysis_input_changed",
          },
          { status: 409 },
        );
      }

      const completedAnalysis = await publishTrainingAnalysis(prisma, {
        jobKey: analysisJobKey(sessionId),
        ownerToken: analysisJobOwnerToken,
        sessionId,
        analysisId: processingAnalysis.id,
        inputHash: analysisInputHash,
        data: {
          overallScore: fallbackAnalysis.overallScore,
          summary:
            "本轮路演与答辩转写文本不可用，系统已生成降级报告。答辩回答内容无法基于文本完整评分，请结合录音回放人工复核。",
          strengthsJson: JSON.stringify(fallbackAnalysis.strengths, null, 2),
          weaknessesJson: JSON.stringify(fallbackAnalysis.weaknesses, null, 2),
          suggestionsJson: JSON.stringify(fallbackAnalysis.suggestions, null, 2),
          coverageJson: JSON.stringify(
            fallbackAnalysis.contentCoverage,
            null,
            2,
          ),
          timingJson: JSON.stringify(fallbackAnalysis.timing, null, 2),
          slideSyncJson: JSON.stringify(fallbackAnalysis.slideSync, null, 2),
          riskQuestionsJson: JSON.stringify(
            fallbackAnalysis.riskQuestions,
            null,
            2,
          ),
          rawResultJson: JSON.stringify(fallbackAnalysis, null, 2),
          errorMessage: null,
        },
      });
      processingAnalysisId = null;

      return NextResponse.json({
        analysis: serializeAnalysis(completedAnalysis),
      });
    }

    const snapshotContext = parseProjectAIContextSnapshot(
      session.projectContextSnapshot,
    );
    const [contextResult, template] = await Promise.all([
      snapshotContext ?? buildProjectAIContext(session.projectId),
      loadPromptTemplate("pitch-performance-analysis"),
    ]);
    const aiContext = compactContext(contextResult);
    const userPrompt = buildAnalysisPrompt(aiContext, template, {
      session: {
        id: session.id,
        status: session.status,
        pitchStartedAt: session.pitchStartedAt?.toISOString() ?? null,
        pitchEndedAt: session.pitchEndedAt?.toISOString() ?? null,
        pitchDurationSec: durationSec,
        currentPageIndex: session.currentPageIndex,
      },
      slideEvents: session.slideEvents.map((event) => ({
        eventType: event.eventType,
        pageIndex: event.pageIndex,
        elapsedSec: event.elapsedSec,
        createdAt: event.createdAt.toISOString(),
      })),
      transcript: transcript
        ? {
            id: transcript.id,
            source: transcript.source,
            language: transcript.language,
            completedAt: transcript.completedAt?.toISOString() ?? null,
            text: transcript.text,
          }
        : {
            id: null,
            source: "NONE",
            language: "zh-CN",
            completedAt: null,
            text: transcriptMissing
              ? "【路演转写缺失】路演录音转写失败或超时，分析将基于项目材料、答辩数据及录音元信息降级进行。"
              : "",
      },
      qaData,
      dynamicFollowupData,
    });
    let analysisJson: TrainingAnalysisResult;
    let analysisParseFailureDebug: AnalysisParseFailureDebug | null = null;
    let aiResult: Awaited<ReturnType<typeof callAI>> | null = null;
    let jsonModeEmptyContent: EmptyContentDetails | null = null;
    let retryWithoutJsonMode: RetryWithoutJsonModeDebug | null = null;

    try {
      aiResult = await callAI({
        task: "pitchAnalysis",
        systemPrompt:
          "你是严格遵守 JSON 输出约束的专业路演训练教练。只输出合法 JSON，不输出 Markdown 或额外解释。",
        userPrompt,
        temperature: 0.2,
        maxOutputTokens: PITCH_ANALYSIS_MAX_OUTPUT_TOKENS,
      });
    } catch (aiCallError) {
      if (!(aiCallError instanceof AIEmptyContentError)) {
        throw aiCallError;
      }

      jsonModeEmptyContent = getEmptyContentDetails(aiCallError);
      devWarn(
        `路演表现分析 JSON mode 返回空内容，开始普通模式重试。${JSON.stringify({
          sessionId,
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
          userPrompt,
          temperature: 0.2,
          maxOutputTokens: PITCH_ANALYSIS_MAX_OUTPUT_TOKENS,
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

        analysisParseFailureDebug = buildAnalysisEmptyContentDebug({
          error: retryError,
          jsonModeEmptyContent,
        });
        devError(
          `路演表现分析普通模式重试仍返回空内容，使用降级 fallback。${JSON.stringify({
            sessionId,
            finishReason: retryError.finishReason,
          })}`,
        );
        void writeDiagnosticEvent({
          type: "REPORT_ERROR",
          message: "Pitch analysis retry without response_format returned empty content",
          meta: {
            finishReason: retryError.finishReason,
          },
        });
      }
    }

    try {
      if (aiResult) {
        analysisJson = await parseAnalysisJsonWithRepair(aiResult.text, {
          sessionId,
          jsonModeEmptyContent,
          retryWithoutJsonMode,
        });
      } else {
        analysisJson = buildFallbackAnalysis({
          durationSec,
          pageCount,
          slideEventCount: session.slideEvents.length,
          transcriptMissing,
          qaData,
          dynamicFollowupData,
          failureReason: "AI_EMPTY_CONTENT",
        });
      }
    } catch (analysisParseError) {
      if (analysisParseError instanceof AnalysisJsonRepairError) {
        analysisParseFailureDebug = analysisParseError.debug;
      }
      devError(
        `路演表现分析 JSON 修复后仍失败，使用降级 fallback。${JSON.stringify({
          sessionId,
          error:
            analysisParseError instanceof Error
              ? analysisParseError.message
              : String(analysisParseError),
          rawAiOutputLength: analysisParseFailureDebug?.rawAiOutputLength ?? null,
        })}`,
      );
      analysisJson = buildFallbackAnalysis({
        durationSec,
        pageCount,
        slideEventCount: session.slideEvents.length,
        transcriptMissing,
        qaData,
        dynamicFollowupData,
        failureReason: "STRUCTURED_OUTPUT_INVALID",
      });
      devLog("[analysis:POST] fallback analysis created", {
        sessionId,
        qaReviewCount: analysisJson.qaReviews?.length ?? 0,
        hasDynamicFollowupReview: analysisJson.dynamicFollowupReview !== null,
      });
    }

    // 空回答/无效回答容错：确保每个 QA 问题都有合理的 qaReview
    const noAnswerQuestionIds = new Set(
      qaData
        .filter((q) => {
          if (q.answerDurationSec === null) return true;
          if (q.answerDurationSec < 2) return true;
          if (q.transcribeStatus === "FAILED") return true;
          if (
            q.transcribeStatus === "COMPLETED" &&
            !q.transcribeText?.trim()
          )
            return true;
          return false;
        })
        .map((q) => q.questionId),
    );

    // PENDING/PROCESSING 转写：不是"未作答"，是"转写未完成"
    const pendingTranscribeQuestionIds = new Set(
      qaData
        .filter((q) => q.transcribePending)
        .map((q) => q.questionId),
    );

    const existingQaReviews: QaReview[] = analysisJson.qaReviews ?? [];
    const reviewedQuestionIds = new Set(
      existingQaReviews.map((r) => r.questionId),
    );

    const missingReviews: QaReview[] = qaData
      .filter((q) => !reviewedQuestionIds.has(q.questionId))
      .map((q) => {
        const isNoAnswer = noAnswerQuestionIds.has(q.questionId);
        const isPending = pendingTranscribeQuestionIds.has(q.questionId);
        return {
          questionId: q.questionId,
          questionIndex: q.orderIndex,
          dimension: "OTHER" as const,
          question: q.questionText,
          judgeIntent: "评委意图暂未明确记录。",
          answerSummary: isPending
            ? "转写尚未完成，分析依据不足。"
            : isNoAnswer
              ? "未检测到有效回答，或当前转写文本不足以判断回答内容。"
              : "回答摘要暂时无法提供。",
          responseQuality: "WEAK" as const,
          responseQualityLabel: isPending
            ? "转写超时，分析依据不足"
            : "回答缺失或偏弱",
          missingPoints: isNoAnswer
            ? ["未正面回应评委问题", "未提供数据、案例或材料依据"]
            : [],
          evidenceUse: "未能提供有效证据。",
          improvementAdvice:
            "建议围绕评委问题正面作答，并补充关键数据、案例或验证依据。",
          betterAnswerOutline: [
            `针对"${q.questionText}"，建议先明确回答核心问题`,
            "结合项目材料补充关键数据或案例",
            "总结回答要点，呼应评委关注点",
          ],
        };
      });

    // 对已有但回答无效的 qaReview，确保其 quality 为 WEAK
    const normalizedQaReviews: QaReview[] = existingQaReviews.map((review) => {
      if (noAnswerQuestionIds.has(review.questionId)) {
        return {
          ...review,
          responseQuality: "WEAK" as const,
          responseQualityLabel: "回答缺失或偏弱",
          answerSummary:
            review.answerSummary ||
            "未检测到有效回答，或当前转写文本不足以判断回答内容。",
          evidenceUse: review.evidenceUse || "未能提供有效证据。",
          missingPoints: review.missingPoints?.length
            ? review.missingPoints
            : ["未正面回应评委问题", "未提供数据、案例或材料依据"],
          improvementAdvice:
            review.improvementAdvice ||
            "建议围绕评委问题正面作答，并补充关键数据、案例或验证依据。",
          betterAnswerOutline: review.betterAnswerOutline?.length
            ? review.betterAnswerOutline
            : [
                `针对"${review.question}"，建议先明确回答核心问题`,
                "结合项目材料补充关键数据或案例",
                "总结回答要点，呼应评委关注点",
              ],
        };
      }
      if (pendingTranscribeQuestionIds.has(review.questionId)) {
        return {
          ...review,
          responseQuality: "WEAK" as const,
          responseQualityLabel: "转写超时，分析依据不足",
          answerSummary:
            review.answerSummary || "转写尚未完成，分析依据不足。",
          evidenceUse: review.evidenceUse || "未能提供有效证据。",
          missingPoints: review.missingPoints?.length
            ? review.missingPoints
            : ["转写未完成，无法评估回答内容"],
          improvementAdvice:
            review.improvementAdvice ||
            "转写完成后可重新生成分析以获得更准确的评估。",
          betterAnswerOutline: review.betterAnswerOutline?.length
            ? review.betterAnswerOutline
            : [
                `针对"${review.question}"，建议先明确回答核心问题`,
                "结合项目材料补充关键数据或案例",
                "总结回答要点，呼应评委关注点",
              ],
        };
      }
      return review;
    });

    analysisJson.qaReviews = [...normalizedQaReviews, ...missingReviews];

    const latestInputHash = await calculateTrainingAnalysisInputHash(sessionId);
    if (!latestInputHash || latestInputHash !== analysisInputHash) {
      await prisma.trainingAnalysis.update({
        where: { id: processingAnalysis.id },
        data: {
          status: "FAILED",
          errorMessage: "报告生成期间训练输入发生变化，请重新生成。",
        },
      });
      processingAnalysisId = null;
      analysisJobError = "analysis input changed while generating";
      return NextResponse.json(
        {
          error: "报告生成期间训练输入发生变化，请重新生成。",
          reason: "analysis_input_changed",
        },
        { status: 409 },
      );
    }

    const completedAnalysis = await publishTrainingAnalysis(prisma, {
      jobKey: analysisJobKey(sessionId),
      ownerToken: analysisJobOwnerToken,
      sessionId,
      analysisId: processingAnalysis.id,
      inputHash: analysisInputHash,
      data: {
        overallScore: analysisJson.overallScore,
        summary: analysisJson.summary,
        strengthsJson: JSON.stringify(analysisJson.strengths, null, 2),
        weaknessesJson: JSON.stringify(analysisJson.weaknesses, null, 2),
        suggestionsJson: JSON.stringify(analysisJson.suggestions, null, 2),
        coverageJson: JSON.stringify(analysisJson.contentCoverage, null, 2),
        timingJson: JSON.stringify(analysisJson.timing, null, 2),
        slideSyncJson: JSON.stringify(analysisJson.slideSync, null, 2),
        riskQuestionsJson: JSON.stringify(
          analysisJson.riskQuestions,
          null,
          2,
        ),
        rawResultJson: buildStoredAnalysisResult(
          analysisJson,
          analysisParseFailureDebug,
        ),
        errorMessage: analysisParseFailureDebug
          ? analysisParseFailureDebug.reason === "AI_EMPTY_CONTENT"
            ? "AI 返回内容为空，已生成降级报告。详情见 rawResultJson._debug。"
            : "AI 结构化输出不符合报告 Schema，修复重试失败后已生成降级报告。详情见 rawResultJson._debug。"
          : null,
      },
    });
    processingAnalysisId = null;

    return NextResponse.json({ analysis: serializeAnalysis(completedAnalysis) });
  } catch (error) {
    const message = getFriendlyErrorMessage(error);
    analysisJobError = message;

    if (processingAnalysisId) {
      await prisma.trainingAnalysis.update({
        where: {
          id: processingAnalysisId,
        },
        data: {
          status: "FAILED",
          errorMessage: message,
        },
      });
    }

    if (error instanceof ProjectContextNotFoundError) {
      return NextResponse.json({ error: error.message }, { status: 404 });
    }

    devError("路演表现分析生成失败。", { error: message });

    return NextResponse.json({ error: message }, { status: 500 });
  } finally {
    if (hasGenerationLock) {
      await releaseAsyncJob({
        jobKey: analysisJobKey(sessionId),
        ownerToken: analysisJobOwnerToken,
        status: analysisJobError ? "FAILED" : "COMPLETED",
        errorMessage: analysisJobError,
      });
    }
  }
}
