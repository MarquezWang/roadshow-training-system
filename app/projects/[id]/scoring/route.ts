import { NextRequest, NextResponse } from "next/server";
import { getCurrentAccessUserId, withOwnerFilter } from "@/lib/auth-server";
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
import { validateScoreResult } from "@/lib/scoring-validator";

type ScoringRouteContext = Readonly<{
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

function buildScoringPrompt(context: ProjectAIContext, template: string) {
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
  });
}

export async function POST(
  request: NextRequest,
  context: ScoringRouteContext,
) {
  const { id } = await context.params;

  try {
    const userId = await getCurrentAccessUserId();
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
          scoringError:
            "没有可纳入 AI 分析的成功解析文件，请先上传、解析并纳入 AI 上下文。",
        }),
      );
    }

    const aiContext = await buildProjectAIContext(id);

    if (!aiContext.evaluationRule) {
      throw new Error("未找到可用于评分的评审规则。");
    }

    if (aiContext.criteria.length === 0) {
      throw new Error("当前评审规则没有评分指标，无法生成 AI 评分。");
    }

    const template = await loadPromptTemplate("scoring");
    const userPrompt = buildScoringPrompt(aiContext, template);
    const aiResult = await callAI({
      task: "scoring",
      systemPrompt:
        "你是严格遵循 JSON 输出约束的路演大赛评分专家。只输出合法 JSON，不输出 Markdown 或额外解释。",
      userPrompt,
      temperature: 0.1,
      maxOutputTokens: 6_000,
    });
    const scoreJson = validateScoreResult(
      parseAIJson(aiResult.text),
      aiContext.criteria.map((criterion) => ({
        category: criterion.category,
        name: criterion.name,
        weight: criterion.weight,
      })),
    );

    await prisma.scoreResult.create({
      data: {
        projectId: id,
        ruleId: aiContext.evaluationRule.id,
        totalScore: scoreJson.totalScore,
        scoreDetail: JSON.stringify(
          {
            categoryScores: scoreJson.categoryScores,
            scoreItems: scoreJson.scoreItems,
            scoreWarnings: scoreJson.scoreWarnings,
          },
          null,
          2,
        ),
        comments: scoreJson.overallComment,
      },
    });

    return redirectToProject(
      request,
      id,
      new URLSearchParams({ scoringStatus: "success" }),
    );
  } catch (error) {
    if (error instanceof ProjectContextNotFoundError) {
      return new NextResponse(error.message, { status: 404 });
    }

    const message = error instanceof Error ? error.message : "AI 评分生成失败。";

    if (
      message.includes("AI 返回内容不是合法 JSON") ||
      message.includes("评分 JSON")
    ) {
      console.error("AI 评分结果解析或校验失败。", { error: message });
    }

    return redirectToProject(
      request,
      id,
      new URLSearchParams({ scoringError: message }),
    );
  }
}
