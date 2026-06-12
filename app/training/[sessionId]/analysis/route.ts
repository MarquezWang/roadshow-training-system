import { NextRequest, NextResponse } from "next/server";
import { callAI } from "@/lib/ai";
import {
  buildProjectAIContext,
  ProjectContextNotFoundError,
  type ProjectAIContext,
} from "@/lib/project-context";
import { AIJsonParseError, parseAIJson } from "@/lib/json-utils";
import { loadPromptTemplate } from "@/lib/prompt-loader";
import { renderPrompt } from "@/lib/prompt-renderer";
import { prisma } from "@/lib/prisma";
import {
  validateTrainingAnalysisResult,
  type TrainingAnalysisResult,
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
const PITCH_ANALYSIS_MAX_OUTPUT_TOKENS = 6_000;
const CONTEXT_EXPERT_COMMENT_LIMIT = 10;
const CONTEXT_HISTORICAL_QUESTION_LIMIT = 10;

function parseStoredJson<T>(value: string, fallback: T): T {
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

function serializeAnalysis(analysis: TrainingAnalysisRecord) {
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
    summary: analysis.summary,
    strengths: parseStoredJson<string[]>(analysis.strengthsJson, []),
    weaknesses: parseStoredJson<string[]>(analysis.weaknessesJson, []),
    suggestions: parseStoredJson<string[]>(analysis.suggestionsJson, []),
    coverage: parseStoredJson<TrainingAnalysisResult["contentCoverage"]>(
      analysis.coverageJson,
      [],
    ),
    timing: parseStoredJson<Record<string, unknown>>(analysis.timingJson, {}),
    slideSync: parseStoredJson<Record<string, unknown>>(
      analysis.slideSyncJson,
      {},
    ),
    riskQuestions: parseStoredJson<string[]>(analysis.riskQuestionsJson, []),
    rawResult: parseStoredJson<Record<string, unknown>>(
      analysis.rawResultJson,
      {},
    ),
    errorMessage: analysis.errorMessage,
    createdAt: analysis.createdAt.toISOString(),
    updatedAt: analysis.updatedAt.toISOString(),
  };
}

async function findLatestAnalysis(sessionId: string) {
  return prisma.trainingAnalysis.findFirst({
    where: {
      sessionId,
      analysisType: PITCH_ANALYSIS_TYPE,
    },
    orderBy: {
      updatedAt: "desc",
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

function buildAnalysisPrompt(
  context: ProjectAIContext,
  template: string,
  input: {
    session: unknown;
    slideEvents: unknown;
    transcript: unknown;
  },
) {
  return renderPrompt(template, {
    session: input.session,
    slideEvents: input.slideEvents,
    transcript: input.transcript,
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

function buildRepairPrompt(rawText: string, error: AIJsonParseError) {
  return renderPrompt(
    [
      "请修复下面这段 AI 输出，使其成为一个合法 JSON 对象。",
      "只输出修复后的 JSON，不要输出 Markdown、代码块或解释文字。",
      "不要新增事实，不要补充转写文本中没有的表达。",
      "如果原文被截断或字段不完整，请在保持结构合法的前提下，用短句补齐未闭合的字符串、数组和对象。",
      "所有字符串必须闭合，所有数组和对象必须闭合。",
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
      '  "riskQuestions": []',
      "}",
      "",
      "需要修复的原始返回：",
      "{{rawText}}",
    ].join("\n"),
    {
      parseError: error.message,
      originalLength: error.originalLength,
      extractedLength: error.extractedLength,
      parsePosition: error.parsePosition ?? "unknown",
      rawText,
    },
  );
}

async function parseAnalysisJsonWithRepair(rawText: string) {
  try {
    return validateTrainingAnalysisResult(parseAIJson(rawText));
  } catch (error) {
    if (!(error instanceof AIJsonParseError)) {
      throw error;
    }

    console.error("路演表现分析 JSON 解析失败，开始一次修复重试。", {
      error: error.message,
      originalLength: error.originalLength,
      extractedLength: error.extractedLength,
      parsePosition: error.parsePosition,
    });

    const repairResult = await callAI({
      systemPrompt:
        "你是严格的 JSON 修复器。只输出合法 JSON，不输出 Markdown 或解释。",
      userPrompt: buildRepairPrompt(rawText, error),
      temperature: 0,
      maxOutputTokens: PITCH_ANALYSIS_MAX_OUTPUT_TOKENS,
    });

    return validateTrainingAnalysisResult(parseAIJson(repairResult.text));
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
  transcriptId: string;
  durationSec: number;
  pageCount: number | null;
  slideEventCount: number;
}) {
  const latestAnalysis = await findLatestAnalysis(input.sessionId);
  const baseData = {
    projectId: input.projectId,
    transcriptId: input.transcriptId,
    status: "PROCESSING",
    analysisType: PITCH_ANALYSIS_TYPE,
    durationSec: input.durationSec,
    pageCount: input.pageCount,
    slideEventCount: input.slideEventCount,
    overallScore: null,
    summary: "",
    strengthsJson: "[]",
    weaknessesJson: "[]",
    suggestionsJson: "[]",
    coverageJson: "[]",
    timingJson: "{}",
    slideSyncJson: "{}",
    riskQuestionsJson: "[]",
    rawResultJson: "{}",
    errorMessage: null,
  };

  if (latestAnalysis) {
    return prisma.trainingAnalysis.update({
      where: {
        id: latestAnalysis.id,
      },
      data: baseData,
    });
  }

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
  const analysis = await findLatestAnalysis(sessionId);

  if (!analysis) {
    return NextResponse.json({ analysis: null });
  }

  return NextResponse.json({ analysis: serializeAnalysis(analysis) });
}

export async function POST(
  _request: NextRequest,
  context: TrainingAnalysisRouteContext,
) {
  const { sessionId } = await context.params;
  let processingAnalysisId: string | null = null;

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
      },
    });

    if (!session) {
      return NextResponse.json({ error: "训练场次不存在。" }, { status: 404 });
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

    const transcript = session.transcripts[0];

    if (!transcript?.text.trim()) {
      return NextResponse.json(
        { error: "未找到路演转写文本。请确保 PITCH 阶段录音已自动转写完成，或手动保存转写文本后再分析。" },
        { status: 400 },
      );
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
      transcriptId: transcript.id,
      durationSec,
      pageCount,
      slideEventCount: session.slideEvents.length,
    });

    processingAnalysisId = processingAnalysis.id;

    const [contextResult, template] = await Promise.all([
      buildProjectAIContext(session.projectId),
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
      transcript: {
        id: transcript.id,
        source: transcript.source,
        language: transcript.language,
        completedAt: transcript.completedAt?.toISOString() ?? null,
        text: transcript.text,
      },
    });
    const aiResult = await callAI({
      systemPrompt:
        "你是严格遵守 JSON 输出约束的专业路演训练教练。只输出合法 JSON，不输出 Markdown 或额外解释。",
      userPrompt,
      temperature: 0.2,
      maxOutputTokens: PITCH_ANALYSIS_MAX_OUTPUT_TOKENS,
    });
    const analysisJson = await parseAnalysisJsonWithRepair(aiResult.text);
    const completedAnalysis = await prisma.trainingAnalysis.update({
      where: {
        id: processingAnalysis.id,
      },
      data: {
        status: "COMPLETED",
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
        rawResultJson: JSON.stringify(analysisJson, null, 2),
        errorMessage: null,
      },
    });

    return NextResponse.json({ analysis: serializeAnalysis(completedAnalysis) });
  } catch (error) {
    const message = getFriendlyErrorMessage(error);

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

    console.error("路演表现分析生成失败。", { error: message });

    return NextResponse.json({ error: message }, { status: 500 });
  }
}
