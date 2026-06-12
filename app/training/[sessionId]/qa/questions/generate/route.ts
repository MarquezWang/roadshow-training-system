import { NextRequest, NextResponse } from "next/server";
import { callAI } from "@/lib/ai";
import {
  buildProjectAIContext,
  ProjectContextNotFoundError,
} from "@/lib/project-context";
import { parseAIJson, AIJsonParseError } from "@/lib/json-utils";
import { loadPromptTemplate } from "@/lib/prompt-loader";
import { renderPrompt } from "@/lib/prompt-renderer";
import { prisma } from "@/lib/prisma";
import { validateGeneratedTrainingQuestions } from "@/lib/training-qa-validator";

type GenerateTrainingQuestionsContext = Readonly<{
  params: Promise<{
    sessionId: string;
  }>;
}>;

const allowedStatuses = new Set([
  "PITCHING",
  "PITCH_ENDED",
  "QA_READY",
  "QAING",
]);

interface LockEntry {
  startedAt: number;
}

const STALE_LOCK_MS = 60_000; // 60 秒后视为 stale lock

// 内存级生成锁，防止并发重复生成
const generationLocks = new Map<string, LockEntry>();

function getLockAgeMs(sessionId: string): number | null {
  const lock = generationLocks.get(sessionId);
  if (!lock) return null;
  return Date.now() - lock.startedAt;
}

function isLockStale(sessionId: string): boolean {
  const age = getLockAgeMs(sessionId);
  return age !== null && age > STALE_LOCK_MS;
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

function serializeQuestion(
  question: {
    id: string;
    orderIndex: number;
    questionText: string;
    questionType: string | null;
    source: string;
    basis: string | null;
    createdAt: Date;
    updatedAt: Date;
    answer?: {
      id: string;
      answerText: string | null;
      revealedQuestionText: boolean;
      startedAt: Date | null;
      endedAt: Date | null;
      durationSec: number | null;
    } | null;
  },
) {
  return {
    id: question.id,
    orderIndex: question.orderIndex,
    questionText: question.questionText,
    questionType: question.questionType,
    source: question.source,
    basis: question.basis,
    answer: question.answer
      ? {
          id: question.answer.id,
          answerText: question.answer.answerText,
          revealedQuestionText: question.answer.revealedQuestionText,
          startedAt: question.answer.startedAt?.toISOString() ?? null,
          endedAt: question.answer.endedAt?.toISOString() ?? null,
          durationSec: question.answer.durationSec,
        }
      : null,
    createdAt: question.createdAt.toISOString(),
    updatedAt: question.updatedAt.toISOString(),
  };
}

async function getExistingQuestions(sessionId: string) {
  const questions = await prisma.trainingQuestion.findMany({
    where: {
      sessionId,
    },
    orderBy: {
      orderIndex: "asc",
    },
    include: {
      answer: {
        select: {
          id: true,
          answerText: true,
          revealedQuestionText: true,
          startedAt: true,
          endedAt: true,
          durationSec: true,
        },
      },
    },
  });

  return questions.map(serializeQuestion);
}

async function getLatestTranscript(sessionId: string) {
  return prisma.trainingTranscript.findFirst({
    where: {
      sessionId,
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
    select: {
      id: true,
      text: true,
      source: true,
      updatedAt: true,
    },
  });
}

async function getLatestPitchAnalysis(sessionId: string) {
  const analysis = await prisma.trainingAnalysis.findFirst({
    where: {
      sessionId,
      analysisType: "PITCH",
      status: "COMPLETED",
    },
    orderBy: {
      updatedAt: "desc",
    },
    select: {
      overallScore: true,
      summary: true,
      strengthsJson: true,
      weaknessesJson: true,
      suggestionsJson: true,
      coverageJson: true,
      timingJson: true,
      slideSyncJson: true,
      riskQuestionsJson: true,
      updatedAt: true,
    },
  });

  if (!analysis) {
    return null;
  }

  return {
    overallScore: analysis.overallScore,
    summary: analysis.summary,
    strengths: parseStoredJson(analysis.strengthsJson),
    weaknesses: parseStoredJson(analysis.weaknessesJson),
    suggestions: parseStoredJson(analysis.suggestionsJson),
    coverage: parseStoredJson(analysis.coverageJson),
    timing: parseStoredJson(analysis.timingJson),
    slideSync: parseStoredJson(analysis.slideSyncJson),
    riskQuestions: parseStoredJson(analysis.riskQuestionsJson),
    updatedAt: analysis.updatedAt.toISOString(),
  };
}

export async function GET(
  _request: NextRequest,
  context: GenerateTrainingQuestionsContext,
) {
  const { sessionId } = await context.params;

  try {
    const session = await prisma.trainingSession.findUnique({
      where: { id: sessionId },
      select: { id: true, status: true },
    });

    if (!session) {
      console.log("[qa:generate:GET] session not found", { sessionId });
      return NextResponse.json({ error: "训练场次不存在。" }, { status: 404 });
    }

    const existingQuestions = await getExistingQuestions(sessionId);
    const isGenerating = generationLocks.has(sessionId);
    const lockAgeMs = getLockAgeMs(sessionId);
    const lockStale = isLockStale(sessionId);

    console.log("[qa:generate:GET]", {
      sessionId,
      questionsCount: existingQuestions.length,
      isGenerating,
      lockAgeMs,
      lockStale,
    });

    // 如果锁已过期，清理它
    if (lockStale) {
      console.log("[qa:generate:GET] cleaning stale lock", {
        sessionId,
        lockAgeMs,
      });
      generationLocks.delete(sessionId);
    }

    return NextResponse.json({
      questions: existingQuestions,
      isGenerating: isGenerating && !lockStale,
    });
  } catch (error) {
    console.error("[qa:generate:GET] error", { sessionId, error });
    return NextResponse.json(
      { error: "获取答辩问题失败。" },
      { status: 500 },
    );
  }
}

export async function POST(
  _request: NextRequest,
  context: GenerateTrainingQuestionsContext,
) {
  const { sessionId } = await context.params;

  try {
    const session = await prisma.trainingSession.findUnique({
      where: {
        id: sessionId,
      },
      select: {
        id: true,
        projectId: true,
        status: true,
      },
    });

    if (!session) {
      console.log("[qa:generate:POST] session not found", { sessionId });
      return NextResponse.json({ error: "训练场次不存在。" }, { status: 404 });
    }

    if (!allowedStatuses.has(session.status)) {
      console.log("[qa:generate:POST] invalid status", {
        sessionId,
        status: session.status,
      });
      return NextResponse.json(
        { error: "当前训练状态不能生成答辩问题。" },
        { status: 400 },
      );
    }

    const existingQuestions = await getExistingQuestions(session.id);

    if (existingQuestions.length > 0) {
      console.log("[qa:generate:POST] questions already exist", {
        sessionId,
        count: existingQuestions.length,
      });
      return NextResponse.json({ questions: existingQuestions });
    }

    // 检查生成锁
    const lockAgeMs = getLockAgeMs(session.id);
    const lockExists = generationLocks.has(session.id);
    const lockStale = isLockStale(session.id);

    console.log("[qa:generate:POST] lock check", {
      sessionId,
      lockExists,
      lockAgeMs,
      lockStale,
    });

    if (lockExists) {
      if (lockStale) {
        // Stale lock，清理并重新生成
        console.log("[qa:generate:POST] cleaning stale lock, regenerating", {
          sessionId,
          lockAgeMs,
        });
        generationLocks.delete(session.id);
      } else {
        console.log("[qa:generate:POST] generation in progress, returning 409", {
          sessionId,
          lockAgeMs,
        });
        return NextResponse.json(
          {
            error: "答辩问题正在生成中，请稍后重试。",
            generating: true,
            lockAgeMs,
            message: `问题生成已进行 ${Math.round((lockAgeMs ?? 0) / 1000)} 秒，请等待。`,
          },
          { status: 409 },
        );
      }
    }

    // 设置生成锁
    console.log("[qa:generate:POST] starting generation", { sessionId });
    generationLocks.set(session.id, { startedAt: Date.now() });

    try {
      const [aiContext, template, transcript, pitchAnalysis] =
        await Promise.all([
          buildProjectAIContext(session.projectId),
          loadPromptTemplate("training-qa-question-generation"),
          getLatestTranscript(session.id),
          getLatestPitchAnalysis(session.id),
        ]);
      const userPrompt = renderPrompt(template, {
        project: aiContext.project,
        files: aiContext.files.map((file) => ({
          id: file.id,
          originalName: file.originalName,
          fileType: file.fileType,
          extractedText: file.extractedText,
          truncated: file.truncated,
        })),
        evaluationRule: aiContext.evaluationRule,
        criteria: aiContext.criteria,
        transcript: transcript
          ? {
              id: transcript.id,
              source: transcript.source,
              text: transcript.text,
              updatedAt: transcript.updatedAt.toISOString(),
            }
          : null,
        pitchAnalysis,
      });
      const baseSystemPrompt =
        "你是严格遵守 JSON 输出约束的路演答辩教练。只输出合法 JSON，不输出 Markdown 或额外解释。";

      let aiResult = await callAI({
        systemPrompt: baseSystemPrompt,
        userPrompt,
        temperature: 0.2,
        maxOutputTokens: 2_000,
      });

      let generatedQuestions;
      try {
        generatedQuestions = validateGeneratedTrainingQuestions(
          parseAIJson(aiResult.text),
        );
      } catch (error) {
        if (!(error instanceof AIJsonParseError)) {
          throw error;
        }

        console.warn("[qa:generate:POST] JSON parse failed, retrying", {
          sessionId,
          error: error.message,
        });

        aiResult = await callAI({
          systemPrompt: `${baseSystemPrompt}\n\n重要：确保所有字符串值中的双引号、换行符等特殊字符都已正确转义。输出必须是严格合法的 JSON，不要有任何 JSON 语法错误。`,
          userPrompt,
          temperature: 0,
          maxOutputTokens: 2_000,
        });

        generatedQuestions = validateGeneratedTrainingQuestions(
          parseAIJson(aiResult.text),
        );
      }

      await prisma.trainingQuestion.createMany({
        data: generatedQuestions.map((question) => ({
          sessionId: session.id,
          projectId: session.projectId,
          orderIndex: question.orderIndex,
          questionText: question.questionText,
          questionType: question.questionType,
          source: "AI",
          basis: question.basis,
        })),
      });

      const savedQuestions = await getExistingQuestions(session.id);

      console.log("[qa:generate:POST] generation succeeded", {
        sessionId,
        count: savedQuestions.length,
      });

      return NextResponse.json({
        questions: savedQuestions,
      });
    } finally {
      const wasReleased = generationLocks.delete(session.id);
      console.log("[qa:generate:POST] lock released", {
        sessionId,
        wasReleased,
      });
    }
  } catch (error) {
    generationLocks.delete(sessionId);
    console.log("[qa:generate:POST] lock released in outer catch", {
      sessionId,
    });

    if (error instanceof ProjectContextNotFoundError) {
      console.error("[qa:generate:POST] project context not found", {
        sessionId,
        error: error.message,
      });
      return NextResponse.json({ error: error.message }, { status: 404 });
    }

    const message =
      error instanceof Error ? error.message : "答辩问题生成失败。";

    console.error("[qa:generate:POST] generation failed", {
      sessionId,
      error: message,
    });

    return NextResponse.json({ error: message }, { status: 500 });
  }
}