import { NextRequest, NextResponse } from "next/server";
import { callAI } from "@/lib/ai";
import {
  buildProjectAIContext,
  ProjectContextNotFoundError,
  type ProjectAIContext,
} from "@/lib/project-context";
import { AIJsonParseError, parseAIJson } from "@/lib/json-utils";
import { buildMockDiagnosis } from "@/lib/mock-diagnosis";
import { loadPromptTemplate } from "@/lib/prompt-loader";
import { renderPrompt } from "@/lib/prompt-renderer";
import { prisma } from "@/lib/prisma";

type DiagnosisRouteContext = Readonly<{
  params: Promise<{
    id: string;
  }>;
}>;

type MaterialDiagnosisAIResult = {
  projectSummary: string;
  materialCompleteness: string;
  criterionAnalysis: Array<{
    category: string;
    criterion: string;
    maxScore: number;
    materialStatus: string;
    problems: string[];
    suggestions: string[];
  }>;
  keyIssues: string[];
  riskPoints: string[];
  slideSuggestions: string[];
  pitchSuggestions: string[];
  priorityActions: string[];
};

const DIAGNOSIS_MAX_OUTPUT_TOKENS = 6_000;
const DIAGNOSIS_CONTEXT_EXPERT_COMMENT_LIMIT = 10;
const DIAGNOSIS_CONTEXT_HISTORICAL_QUESTION_LIMIT = 10;

function isDiagnosisMockMode() {
  return process.env.DIAGNOSIS_MOCK_MODE === "true";
}

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

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function assertString(value: unknown, fieldName: string) {
  if (typeof value !== "string") {
    throw new Error(`AI JSON 字段 ${fieldName} 必须是字符串。`);
  }

  return value;
}

function assertNumber(value: unknown, fieldName: string) {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`AI JSON 字段 ${fieldName} 必须是数字。`);
  }

  return value;
}

function assertStringArray(value: unknown, fieldName: string) {
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) {
    throw new Error(`AI JSON 字段 ${fieldName} 必须是字符串数组。`);
  }

  return value;
}

function validateDiagnosisJson(value: unknown): MaterialDiagnosisAIResult {
  if (!isRecord(value)) {
    throw new Error("AI JSON 顶层结构必须是对象。");
  }

  const criterionAnalysis = value.criterionAnalysis;

  if (!Array.isArray(criterionAnalysis)) {
    throw new Error("AI JSON 字段 criterionAnalysis 必须是数组。");
  }

  return {
    projectSummary: assertString(value.projectSummary, "projectSummary"),
    materialCompleteness: assertString(
      value.materialCompleteness,
      "materialCompleteness",
    ),
    criterionAnalysis: criterionAnalysis.map((item, index) => {
      if (!isRecord(item)) {
        throw new Error(`AI JSON 字段 criterionAnalysis[${index}] 必须是对象。`);
      }

      return {
        category: assertString(item.category, `criterionAnalysis[${index}].category`),
        criterion: assertString(
          item.criterion,
          `criterionAnalysis[${index}].criterion`,
        ),
        maxScore: assertNumber(
          item.maxScore,
          `criterionAnalysis[${index}].maxScore`,
        ),
        materialStatus: assertString(
          item.materialStatus,
          `criterionAnalysis[${index}].materialStatus`,
        ),
        problems: assertStringArray(
          item.problems,
          `criterionAnalysis[${index}].problems`,
        ),
        suggestions: assertStringArray(
          item.suggestions,
          `criterionAnalysis[${index}].suggestions`,
        ),
      };
    }),
    keyIssues: assertStringArray(value.keyIssues, "keyIssues"),
    riskPoints: assertStringArray(value.riskPoints, "riskPoints"),
    slideSuggestions: assertStringArray(
      value.slideSuggestions,
      "slideSuggestions",
    ),
    pitchSuggestions: assertStringArray(
      value.pitchSuggestions,
      "pitchSuggestions",
    ),
    priorityActions: assertStringArray(value.priorityActions, "priorityActions"),
  };
}

function compactDiagnosisContext(context: ProjectAIContext): ProjectAIContext {
  return {
    ...context,
    expertComments: context.expertComments.slice(
      0,
      DIAGNOSIS_CONTEXT_EXPERT_COMMENT_LIMIT,
    ),
    historicalQuestions: context.historicalQuestions.slice(
      0,
      DIAGNOSIS_CONTEXT_HISTORICAL_QUESTION_LIMIT,
    ),
  };
}

function buildDiagnosisPrompt(context: ProjectAIContext, template: string) {
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

function buildRepairPrompt(
  rawText: string,
  error: AIJsonParseError,
  context: ProjectAIContext,
) {
  return renderPrompt(
    [
      "请修复下面这段 AI 输出，使其成为一个合法 JSON 对象。",
      "只输出修复后的 JSON，不要输出 Markdown、代码块或解释文字。",
      "不要新增事实，不要补写材料中没有的信息。",
      "如果原文被截断，请在保持结构合法的前提下，用短句补齐未闭合的字符串、数组和对象。",
      "criterionAnalysis 必须对应输入的评分指标。",
      "",
      "解析错误：{{parseError}}",
      "原始返回长度：{{originalLength}}",
      "截取后长度：{{extractedLength}}",
      "解析失败位置：{{parsePosition}}",
      "",
      "目标 JSON 结构：",
      "{",
      '  "projectSummary": "",',
      '  "materialCompleteness": "",',
      '  "criterionAnalysis": [',
      "    {",
      '      "category": "",',
      '      "criterion": "",',
      '      "maxScore": 0,',
      '      "materialStatus": "",',
      '      "problems": [],',
      '      "suggestions": []',
      "    }",
      "  ],",
      '  "keyIssues": [],',
      '  "riskPoints": [],',
      '  "slideSuggestions": [],',
      '  "pitchSuggestions": [],',
      '  "priorityActions": []',
      "}",
      "",
      "评分指标：",
      "{{criteria}}",
      "",
      "需要修复的原始返回：",
      "{{rawText}}",
    ].join("\n"),
    {
      parseError: error.message,
      originalLength: error.originalLength,
      extractedLength: error.extractedLength,
      parsePosition: error.parsePosition ?? "未知",
      criteria: context.criteria.map((criterion) => ({
        category: criterion.category,
        name: criterion.name,
        weight: criterion.weight,
      })),
      rawText,
    },
  );
}

async function parseDiagnosisJsonWithRepair(
  rawText: string,
  context: ProjectAIContext,
) {
  try {
    return validateDiagnosisJson(parseAIJson(rawText));
  } catch (error) {
    if (!(error instanceof AIJsonParseError)) {
      throw error;
    }

    console.error("材料诊断 JSON 解析失败，准备执行一次修复重试。", {
      originalLength: error.originalLength,
      extractedLength: error.extractedLength,
      parsePosition: error.parsePosition,
    });

    const repairResult = await callAI({
      task: "materialDiagnosis",
      systemPrompt:
        "你是严格的 JSON 修复器。只输出合法 JSON，不输出 Markdown、代码块或解释。",
      userPrompt: buildRepairPrompt(rawText, error, context),
      temperature: 0,
      maxOutputTokens: DIAGNOSIS_MAX_OUTPUT_TOKENS,
    });

    try {
      return validateDiagnosisJson(parseAIJson(repairResult.text));
    } catch (repairError) {
      if (repairError instanceof AIJsonParseError) {
        console.error("材料诊断 JSON 修复重试仍失败。", {
          originalLength: repairError.originalLength,
          extractedLength: repairError.extractedLength,
          parsePosition: repairError.parsePosition,
        });
      }

      const message =
        repairError instanceof Error ? repairError.message : "JSON 修复失败。";

      throw new Error(
        `材料诊断 JSON 解析失败，已自动修复重试 1 次但仍失败：${message}`,
      );
    }
  }
}

async function buildDiagnosisResult(context: ProjectAIContext) {
  if (isDiagnosisMockMode()) {
    return {
      diagnosisJson: buildMockDiagnosis(context),
      source: "mock",
    };
  }

  const diagnosisContext = compactDiagnosisContext(context);
  const template = await loadPromptTemplate("material-diagnosis");
  const userPrompt = buildDiagnosisPrompt(diagnosisContext, template);
  const aiResult = await callAI({
    task: "materialDiagnosis",
    systemPrompt:
      "你是严格遵守 JSON 输出约束的路演材料诊断专家。只输出合法 JSON，不输出 Markdown、代码块或额外解释。所有字符串、数组和对象必须闭合。",
    userPrompt,
    temperature: 0.1,
    maxOutputTokens: DIAGNOSIS_MAX_OUTPUT_TOKENS,
  });

  return {
    diagnosisJson: await parseDiagnosisJsonWithRepair(
      aiResult.text,
      diagnosisContext,
    ),
    source: "ai",
  };
}

function normalizeDiagnosisErrorMessage(message: string) {
  if (/timeout|timed out|超时|60000ms/i.test(message)) {
    return "材料诊断生成超时：当前材料较长或模型响应较慢。请提高 AI_TIMEOUT_MS，或减少纳入 AI 分析的材料长度后重试。";
  }

  return message;
}

export async function POST(
  request: NextRequest,
  context: DiagnosisRouteContext,
) {
  const { id } = await context.params;

  try {
    const project = await prisma.project.findUnique({
      where: {
        id,
      },
      select: {
        id: true,
      },
    });

    if (!project) {
      return new NextResponse("项目不存在。", { status: 404 });
    }

    const analysableFileCount = await prisma.fileAsset.count({
      where: {
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
          diagnosisError:
            "没有可纳入 AI 分析的成功解析文件，请先上传、解析并纳入 AI 上下文。",
        }),
      );
    }

    const aiContext = await buildProjectAIContext(id);
    const { diagnosisJson, source } = await buildDiagnosisResult(aiContext);

    if (diagnosisJson.criterionAnalysis.length !== aiContext.criteria.length) {
      throw new Error(
        `AI 返回的 criterionAnalysis 数量为 ${diagnosisJson.criterionAnalysis.length}，应为 ${aiContext.criteria.length}。`,
      );
    }

    await prisma.diagnosis.create({
      data: {
        projectId: id,
        summary: diagnosisJson.projectSummary,
        completeness: diagnosisJson.materialCompleteness,
        issues: JSON.stringify(
          {
            criterionAnalysis: diagnosisJson.criterionAnalysis,
            keyIssues: diagnosisJson.keyIssues,
          },
          null,
          2,
        ),
        risks: JSON.stringify(diagnosisJson.riskPoints, null, 2),
        suggestions: JSON.stringify(
          {
            slideSuggestions: diagnosisJson.slideSuggestions,
            pitchSuggestions: diagnosisJson.pitchSuggestions,
            priorityActions: diagnosisJson.priorityActions,
            source,
          },
          null,
          2,
        ),
      },
    });

    return redirectToProject(
      request,
      id,
      new URLSearchParams({ diagnosisStatus: "success" }),
    );
  } catch (error) {
    if (error instanceof ProjectContextNotFoundError) {
      return new NextResponse(error.message, { status: 404 });
    }

    const rawMessage =
      error instanceof Error ? error.message : "材料诊断生成失败。";
    const message = normalizeDiagnosisErrorMessage(rawMessage);

    if (
      rawMessage.includes("AI 返回内容不是合法 JSON") ||
      rawMessage.includes("材料诊断 JSON 解析失败")
    ) {
      console.error("材料诊断 AI 返回解析或修复失败。", {
        error: rawMessage,
      });
    }

    return redirectToProject(
      request,
      id,
      new URLSearchParams({ diagnosisError: message }),
    );
  }
}
