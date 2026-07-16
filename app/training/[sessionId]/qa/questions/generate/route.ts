import { NextRequest, NextResponse } from "next/server";
import { callAI } from "@/lib/ai";
import {
  buildProjectAIContext,
  parseProjectAIContextSnapshot,
  ProjectContextNotFoundError,
} from "@/lib/project-context";
import { parseAIJson, AIJsonParseError } from "@/lib/json-utils";
import { loadPromptTemplate } from "@/lib/prompt-loader";
import { renderPrompt } from "@/lib/prompt-renderer";
import { prisma } from "@/lib/prisma";
import { validateGeneratedTrainingQuestions } from "@/lib/training-qa-validator";
import { devLog, devWarn, devError } from "@/lib/dev-log";
import { isSessionOwnedByCurrentUser } from "@/lib/auth-server";
import {
  acquireAsyncJob,
  getAsyncJob,
  releaseAsyncJob,
} from "@/lib/async-job";

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

const STALE_LOCK_MS = 10 * 60_000;
const questionGenerationJobKey = (sessionId: string) =>
  `qa-question-generation:${sessionId}`;

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
  if (!(await isSessionOwnedByCurrentUser(sessionId))) {
    return NextResponse.json({ error: "Session not found" }, { status: 404 });
  }

  try {
    const session = await prisma.trainingSession.findUnique({
      where: { id: sessionId },
      select: { id: true, status: true },
    });

    if (!session) {
      devLog("[qa:generate:GET] session not found", { sessionId });
      return NextResponse.json({ error: "训练场次不存在。" }, { status: 404 });
    }

    const existingQuestions = await getExistingQuestions(sessionId);
    const job = await getAsyncJob(questionGenerationJobKey(sessionId));
    const isGenerating = Boolean(
      job?.status === "RUNNING" &&
        job.leaseExpiresAt &&
        job.leaseExpiresAt > new Date(),
    );
    const lockAgeMs = job ? Date.now() - job.updatedAt.getTime() : null;
    const lockStale = Boolean(
      job?.status === "RUNNING" &&
        (!job.leaseExpiresAt || job.leaseExpiresAt <= new Date()),
    );

    devLog("[qa:generate:GET]", {
      sessionId,
      questionsCount: existingQuestions.length,
      isGenerating,
      lockAgeMs,
      lockStale,
    });

    return NextResponse.json({
      questions: existingQuestions,
      isGenerating,
    });
  } catch (error) {
    devError("[qa:generate:GET] error", { sessionId, error });
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
  if (!(await isSessionOwnedByCurrentUser(sessionId))) {
    return NextResponse.json({ error: "Session not found" }, { status: 404 });
  }
  let acquiredLockToken: string | null = null;

  try {
    const session = await prisma.trainingSession.findUnique({
      where: {
        id: sessionId,
      },
      select: {
        id: true,
        projectId: true,
        status: true,
        projectContextSnapshot: true,
      },
    });

    if (!session) {
      devLog("[qa:generate:POST] session not found", { sessionId });
      return NextResponse.json({ error: "训练场次不存在。" }, { status: 404 });
    }

    if (!allowedStatuses.has(session.status)) {
      devLog("[qa:generate:POST] invalid status", {
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
      devLog("[qa:generate:POST] questions already exist", {
        sessionId,
        count: existingQuestions.length,
      });
      return NextResponse.json({ questions: existingQuestions });
    }

    // 检查生成锁
    const currentJob = await getAsyncJob(questionGenerationJobKey(session.id));
    const lockAgeMs = currentJob
      ? Date.now() - currentJob.updatedAt.getTime()
      : null;
    const lockExists = Boolean(
      currentJob?.status === "RUNNING" &&
        currentJob.leaseExpiresAt &&
        currentJob.leaseExpiresAt > new Date(),
    );
    const lockStale = Boolean(
      currentJob?.status === "RUNNING" &&
        (!currentJob.leaseExpiresAt || currentJob.leaseExpiresAt <= new Date()),
    );

    devLog("[qa:generate:POST] lock check", {
      sessionId,
      lockExists,
      lockAgeMs,
      lockStale,
    });

    const acquiredJob = await acquireAsyncJob({
      jobKey: questionGenerationJobKey(session.id),
      jobType: "QA_QUESTION_GENERATION",
      resourceId: session.id,
      leaseMs: STALE_LOCK_MS,
    });
    if (!acquiredJob) {
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
    acquiredLockToken = acquiredJob.ownerToken;

    {
      const [aiContext, template, transcript, pitchAnalysis] =
        await Promise.all([
          parseProjectAIContextSnapshot(session.projectContextSnapshot) ??
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
        task: "judgeQuestionGeneration",
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

        devWarn("[qa:generate:POST] JSON parse failed, retrying", {
          sessionId,
          error: error.message,
        });

        aiResult = await callAI({
          task: "judgeQuestionGeneration",
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

      devLog("[qa:generate:POST] generation succeeded", {
        sessionId,
        count: savedQuestions.length,
      });

      const wasReleased = await releaseAsyncJob({
        jobKey: questionGenerationJobKey(session.id),
        ownerToken: acquiredLockToken,
        status: "COMPLETED",
      });
      devLog("[qa:generate:POST] lock released", {
        sessionId,
        wasReleased,
      });

      return NextResponse.json({
        questions: savedQuestions,
      });
    }
  } catch (error) {
    await releaseAsyncJob({
      jobKey: questionGenerationJobKey(sessionId),
      ownerToken: acquiredLockToken,
      status: "FAILED",
      errorMessage: error instanceof Error ? error.message : String(error),
    });
    devLog("[qa:generate:POST] lock released in outer catch", {
      sessionId,
    });

    if (error instanceof ProjectContextNotFoundError) {
      devError("[qa:generate:POST] project context not found", {
        sessionId,
        error: error.message,
      });
      return NextResponse.json({ error: error.message }, { status: 404 });
    }

    const message =
      error instanceof Error ? error.message : "答辩问题生成失败。";

    devError("[qa:generate:POST] generation failed", {
      sessionId,
      error: message,
    });

    return NextResponse.json({ error: message }, { status: 500 });
  }
}
