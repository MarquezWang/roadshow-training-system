import { NextRequest, NextResponse } from "next/server";
import { getCurrentAuthUserId, withOwnerFilter } from "@/lib/auth-server";
import { callAI } from "@/lib/ai";
import {
  buildProjectAIContext,
  ProjectContextNotFoundError,
  type ProjectAIContext,
} from "@/lib/project-context";
import { parseAIJson } from "@/lib/json-utils";
import { loadPromptTemplate } from "@/lib/prompt-loader";
import { renderPrompt } from "@/lib/prompt-renderer";
import { prisma } from "@/lib/prisma";
import { validateGeneratedQuestions } from "@/lib/question-validator";

type QuestionGenerationRouteContext = Readonly<{
  params: Promise<{
    id: string;
  }>;
}>;

function redirectToProject(
  request: NextRequest,
  projectId: string,
  params: URLSearchParams,
) {
  const url = new URL(`/projects/${projectId}`, request.url);
  params.forEach((value, key) => {
    url.searchParams.set(key, value);
  });

  return NextResponse.redirect(url, 303);
}

function parseStoredJson(value: string | null) {
  if (!value) {
    return null;
  }

  try {
    return JSON.parse(value) as unknown;
  } catch {
    return value;
  }
}

function buildQuestionPrompt(
  context: ProjectAIContext,
  template: string,
  latestDiagnosis: unknown,
  latestScoreResult: unknown,
) {
  return renderPrompt(template, {
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
    latestDiagnosis,
    latestScoreResult,
  });
}

async function findLatestDiagnosis(projectId: string) {
  const diagnosis = await prisma.diagnosis.findFirst({
    where: {
      projectId,
    },
    orderBy: {
      createdAt: "desc",
    },
    select: {
      summary: true,
      completeness: true,
      issues: true,
      risks: true,
      suggestions: true,
      createdAt: true,
    },
  });

  if (!diagnosis) {
    return null;
  }

  return {
    summary: diagnosis.summary,
    completeness: diagnosis.completeness,
    issues: parseStoredJson(diagnosis.issues),
    risks: parseStoredJson(diagnosis.risks),
    suggestions: parseStoredJson(diagnosis.suggestions),
    createdAt: diagnosis.createdAt,
  };
}

async function findLatestScoreResult(projectId: string) {
  const scoreResult = await prisma.scoreResult.findFirst({
    where: {
      projectId,
    },
    orderBy: {
      createdAt: "desc",
    },
    select: {
      totalScore: true,
      scoreDetail: true,
      comments: true,
      createdAt: true,
      rule: {
        select: {
          name: true,
          version: true,
          totalScore: true,
        },
      },
    },
  });

  if (!scoreResult) {
    return null;
  }

  return {
    totalScore: scoreResult.totalScore,
    scoreDetail: parseStoredJson(scoreResult.scoreDetail),
    comments: scoreResult.comments,
    rule: scoreResult.rule,
    createdAt: scoreResult.createdAt,
  };
}

export async function POST(
  request: NextRequest,
  context: QuestionGenerationRouteContext,
) {
  const { id } = await context.params;

  try {
    const userId = await getCurrentAuthUserId();
    const project = await prisma.project.findFirst({
      where: withOwnerFilter({ id }, userId),
      select: {
        id: true,
      },
    });

    if (!project) {
      return new NextResponse("项目不存在。", { status: 404 });
    }

    const analysableFileCount = await prisma.fileAsset.count({
      where: userId
        ? {
            projectId: id,
            project: {
              ownerId: userId,
            },
            parseStatus: "SUCCESS",
            includeInAIContext: true,
            extractedText: {
              not: null,
            },
          }
        : {
            projectId: id,
            parseStatus: "SUCCESS",
            includeInAIContext: true,
            extractedText: {
              not: null,
            },
          },
    });

    if (analysableFileCount === 0) {
      return redirectToProject(
        request,
        id,
        new URLSearchParams({
          questionError:
            "没有可纳入 AI 分析的成功解析文件，请先上传、解析并纳入 AI 上下文。",
        }),
      );
    }

    const [aiContext, latestDiagnosis, latestScoreResult] = await Promise.all([
      buildProjectAIContext(id),
      findLatestDiagnosis(id),
      findLatestScoreResult(id),
    ]);

    if (!aiContext.evaluationRule) {
      throw new Error("未找到可用于问题生成的评审规则。");
    }

    if (aiContext.criteria.length === 0) {
      throw new Error("当前评审规则没有评分指标，无法生成模拟评委问题。");
    }

    const template = await loadPromptTemplate("question-generation");
    const userPrompt = buildQuestionPrompt(
      aiContext,
      template,
      latestDiagnosis,
      latestScoreResult,
    );
    const aiResult = await callAI({
      task: "judgeQuestionGeneration",
      systemPrompt:
        "你是严格遵守 JSON 输出约束的路演答辩训练专家。只输出合法 JSON，不输出 Markdown 或额外解释。",
      userPrompt,
      temperature: 0.2,
      maxOutputTokens: 6_000,
    });
    const questionJson = validateGeneratedQuestions(parseAIJson(aiResult.text));

    await prisma.question.createMany({
      data: questionJson.questions.map((question) => ({
        projectId: id,
        type: question.type,
        perspective: question.perspective,
        content: question.content,
        focus: question.focus,
        suggestedDirection: question.suggestedDirection,
        evidenceText: question.evidence.evidenceText,
        evidenceLocation: question.evidence.evidenceLocation,
        factCheckNote: question.factCheckNote,
      })),
    });

    return redirectToProject(
      request,
      id,
      new URLSearchParams({ questionStatus: "success" }),
    );
  } catch (error) {
    if (error instanceof ProjectContextNotFoundError) {
      return new NextResponse(error.message, { status: 404 });
    }

    const message =
      error instanceof Error ? error.message : "模拟评委问题生成失败。";

    if (
      message.includes("AI 返回内容不是合法 JSON") ||
      message.includes("问题 JSON") ||
      message.includes("questions")
    ) {
      console.error("模拟评委问题 AI 结果解析或校验失败。", { error: message });
    }

    return redirectToProject(
      request,
      id,
      new URLSearchParams({ questionError: message }),
    );
  }
}
