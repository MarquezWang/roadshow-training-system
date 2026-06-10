import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

type SaveTrainingAnswerContext = Readonly<{
  params: Promise<{
    sessionId: string;
    questionId: string;
  }>;
}>;

function readAnswerText(value: unknown) {
  if (typeof value !== "string") {
    return "";
  }

  return value.trim();
}

function readOptionalDate(value: unknown) {
  if (typeof value !== "string" || value.trim() === "") {
    return null;
  }

  const parsed = new Date(value);

  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function readOptionalDuration(value: unknown) {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0) {
    return null;
  }

  return value;
}

function readOptionalId(value: unknown) {
  if (typeof value !== "string" || value.trim() === "") {
    return null;
  }

  return value.trim();
}

function getDurationSec(startedAt: Date | null, endedAt: Date) {
  if (!startedAt) {
    return null;
  }

  return Math.max(0, Math.round((endedAt.getTime() - startedAt.getTime()) / 1000));
}

async function finishQa(
  sessionId: string,
  endedAt: Date,
  clientQaDurationSec: number | null,
) {
  const session = await prisma.trainingSession.findUnique({
    where: {
      id: sessionId,
    },
    select: {
      qaStartedAt: true,
    },
  });

  const qaDurationSec =
    clientQaDurationSec ??
    (session?.qaStartedAt
      ? Math.max(
          0,
          Math.round((endedAt.getTime() - session.qaStartedAt.getTime()) / 1000),
        )
      : null);

  return prisma.trainingSession.update({
    where: {
      id: sessionId,
    },
    data: {
      status: "QA_ENDED",
      qaEndedAt: endedAt,
      qaDurationSec,
    },
    select: {
      id: true,
      status: true,
      qaEndedAt: true,
      qaDurationSec: true,
    },
  });
}

export async function POST(
  request: NextRequest,
  context: SaveTrainingAnswerContext,
) {
  const { sessionId, questionId } = await context.params;
  const body = (await request.json().catch(() => ({}))) as {
    answerText?: unknown;
    finish?: unknown;
    answerStartedAt?: unknown;
    revealedQuestionText?: unknown;
    qaDurationSec?: unknown;
    recordingId?: unknown;
  };
  const answerText = readAnswerText(body.answerText);
  const shouldFinish = body.finish === true;
  const answerStartedAt = readOptionalDate(body.answerStartedAt);
  const revealedQuestionText = body.revealedQuestionText === true;
  const clientQaDurationSec = readOptionalDuration(body.qaDurationSec);
  const recordingId = readOptionalId(body.recordingId);
  const session = await prisma.trainingSession.findUnique({
    where: {
      id: sessionId,
    },
    select: {
      id: true,
      status: true,
    },
  });

  if (!session) {
    return NextResponse.json({ error: "训练场次不存在。" }, { status: 404 });
  }

  if (session.status !== "QAING") {
    return NextResponse.json(
      { error: "当前训练状态不能保存答辩回答。" },
      { status: 400 },
    );
  }

  const question = await prisma.trainingQuestion.findFirst({
    where: {
      id: questionId,
      sessionId,
    },
    select: {
      id: true,
      orderIndex: true,
    },
  });

  if (!question) {
    return NextResponse.json({ error: "答辩问题不存在。" }, { status: 404 });
  }

  if (recordingId) {
    const recording = await prisma.trainingRecording.findFirst({
      where: {
        id: recordingId,
        sessionId,
        phase: "QA",
      },
      select: {
        id: true,
      },
    });

    if (!recording) {
      return NextResponse.json(
        { error: "答辩录音不存在或不属于当前题目。" },
        { status: 400 },
      );
    }
  }

  const existingAnswer = await prisma.trainingAnswer.findUnique({
    where: {
      questionId,
    },
    select: {
      startedAt: true,
    },
  });
  const now = new Date();
  const startedAt = existingAnswer?.startedAt ?? answerStartedAt ?? now;
  const durationSec = getDurationSec(startedAt, now);

  await prisma.trainingAnswer.upsert({
    where: {
      questionId,
    },
    update: {
      answerText,
      revealedQuestionText,
      recordingId,
      startedAt,
      endedAt: now,
      durationSec,
    },
    create: {
      sessionId,
      questionId,
      answerText,
      revealedQuestionText,
      recordingId,
      startedAt,
      endedAt: now,
      durationSec,
    },
  });

  const nextQuestion = shouldFinish
    ? null
    : await prisma.trainingQuestion.findFirst({
        where: {
          sessionId,
          orderIndex: {
            gt: question.orderIndex,
          },
        },
        orderBy: {
          orderIndex: "asc",
        },
        select: {
          id: true,
          orderIndex: true,
        },
      });

  if (!nextQuestion) {
    const updatedSession = await finishQa(sessionId, now, clientQaDurationSec);

    return NextResponse.json({
      completed: true,
      session: {
        ...updatedSession,
        qaEndedAt: updatedSession.qaEndedAt?.toISOString() ?? null,
      },
    });
  }

  return NextResponse.json({
    completed: false,
    nextQuestionId: nextQuestion.id,
    nextOrderIndex: nextQuestion.orderIndex,
  });
}
