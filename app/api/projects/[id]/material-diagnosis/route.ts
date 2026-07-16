import { NextRequest, NextResponse } from "next/server";
import { callAI } from "@/lib/ai";
import { getCurrentAccessUserId, withOwnerFilter } from "@/lib/auth-server";
import { AIJsonParseError, parseAIJson } from "@/lib/json-utils";
import {
  normalizeMaterialDiagnosisResult,
  type EvaluationCriterionForDiagnosis,
} from "@/lib/material-diagnosis";
import {
  buildProjectAIContext,
  ProjectContextNotFoundError,
  type ProjectAIContext,
} from "@/lib/project-context";
import { loadPromptTemplate } from "@/lib/prompt-loader";
import { renderPrompt } from "@/lib/prompt-renderer";
import { prisma } from "@/lib/prisma";
import { calculateProjectContextHash } from "@/lib/project-context-hash";

type MaterialDiagnosisRouteContext = Readonly<{
  params: Promise<{
    id: string;
  }>;
}>;

const MATERIAL_DIAGNOSIS_MAX_OUTPUT_TOKENS = 6_000;
const NO_MATERIAL_MESSAGE =
  "当前项目材料不足，建议先上传 PPT/PDF/DOCX/TXT 或完善项目档案。";
const JSON_PARSE_FAILED_MESSAGE =
  "材料诊断结果解析失败，请稍后重试。";

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
    criteria: context.criteria.map((criterion) => ({
      category: criterion.category,
      name: criterion.name,
      weight: criterion.weight,
      description: criterion.description,
      scoringGuide: criterion.scoringGuide,
    })),
  });
}

function getCriteriaForDiagnosis(
  context: ProjectAIContext,
): EvaluationCriterionForDiagnosis[] {
  return context.criteria.map((criterion) => ({
    category: criterion.category,
    name: criterion.name,
    weight: criterion.weight,
  }));
}

function hasMaterialText(context: ProjectAIContext) {
  return context.files.some((file) => file.extractedText.trim().length > 0);
}

function normalizeRouteError(error: unknown) {
  if (error instanceof AIJsonParseError) {
    return JSON_PARSE_FAILED_MESSAGE;
  }

  const message =
    error instanceof Error ? error.message : "材料诊断生成失败，请稍后重试。";

  if (/JSON|json|解析/i.test(message)) {
    return JSON_PARSE_FAILED_MESSAGE;
  }

  if (/timeout|timed out|超时/i.test(message)) {
    return "材料诊断生成超时，请稍后重试或减少纳入 AI 分析的材料长度。";
  }

  return message;
}

export async function POST(
  _request: NextRequest,
  context: MaterialDiagnosisRouteContext,
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
      return NextResponse.json(
        { status: "failed", message: "项目不存在。" },
        { status: 404 },
      );
    }

    const aiContext = await buildProjectAIContext(id);
    const inputHash = calculateProjectContextHash(aiContext);

    if (!hasMaterialText(aiContext)) {
      return NextResponse.json(
        { status: "failed", message: NO_MATERIAL_MESSAGE },
        { status: 400 },
      );
    }

    if (!aiContext.evaluationRule) {
      throw new Error("未找到可用于材料诊断的评审规则。");
    }

    if (aiContext.criteria.length === 0) {
      throw new Error("当前评审规则没有诊断指标。");
    }

    const criteria = getCriteriaForDiagnosis(aiContext);
    const template = await loadPromptTemplate("material-diagnosis");
    const userPrompt = buildDiagnosisPrompt(aiContext, template);
    const aiResult = await callAI({
      task: "materialDiagnosis",
      systemPrompt:
        "你是严格遵守 JSON 输出约束的赛前材料诊断专家。只输出合法 JSON，不输出 Markdown、代码块或额外解释。",
      userPrompt,
      temperature: 0.1,
      maxOutputTokens: MATERIAL_DIAGNOSIS_MAX_OUTPUT_TOKENS,
    });
    const diagnosis = normalizeMaterialDiagnosisResult(
      parseAIJson(aiResult.text),
      criteria,
    );
    const totalWeight = criteria.reduce(
      (total, criterion) => total + criterion.weight,
      0,
    );
    const latestContext = await buildProjectAIContext(id);
    if (calculateProjectContextHash(latestContext) !== inputHash) {
      return NextResponse.json(
        {
          status: "failed",
          message: "诊断生成期间项目材料发生变化，请重新生成。",
        },
        { status: 409 },
      );
    }

    await prisma.materialDiagnosis.create({
      data: {
        projectId: id,
        ruleName: aiContext.evaluationRule.name,
        totalWeight,
        readinessLevel: diagnosis.readinessLevel,
        readinessScore: diagnosis.readinessScore,
        summary: diagnosis.summary,
        strengths: JSON.stringify(diagnosis.strengths, null, 2),
        weaknesses: JSON.stringify(diagnosis.weaknesses, null, 2),
        priorityTasks: JSON.stringify(diagnosis.priorityTasks, null, 2),
        judgeQuestions: JSON.stringify(diagnosis.judgeQuestions, null, 2),
        criteriaResults: JSON.stringify(diagnosis.criteriaResults, null, 2),
        inputHash,
        ruleVersion: aiContext.evaluationRule.version,
      },
    });

    return NextResponse.json({ status: "success", diagnosis });
  } catch (error) {
    if (error instanceof ProjectContextNotFoundError) {
      return NextResponse.json(
        { status: "failed", message: error.message },
        { status: 404 },
      );
    }

    const message = normalizeRouteError(error);
    console.error("赛前材料诊断生成失败。", {
      projectId: id,
      error: error instanceof Error ? error.message : String(error),
    });

    return NextResponse.json(
      {
        status: "failed",
        message,
      },
      { status: 500 },
    );
  }
}
