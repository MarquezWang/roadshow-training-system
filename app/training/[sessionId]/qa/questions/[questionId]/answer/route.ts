import { NextRequest, NextResponse } from "next/server";
import { isSessionOwnedByCurrentUser } from "@/lib/auth-server";
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

  const transition = await prisma.trainingSession.updateMany({
    where: { id: sessionId, status: "QAING" },
    data: {
      status: "QA_ENDED",
      qaEndedAt: endedAt,
      qaDurationSec,
    },
  });
  const updatedSession = await prisma.trainingSession.findUnique({
    where: { id: sessionId },
    select: {
      id: true,
      status: true,
      qaEndedAt: true,
      qaDurationSec: true,
    },
  });

  return { updated: transition.count === 1, session: updatedSession };
}

export async function POST(
  request: NextRequest,
  context: SaveTrainingAnswerContext,
) {
  const { sessionId, questionId } = await context.params;
  if (!(await isSessionOwnedByCurrentUser(sessionId))) {
    return NextResponse.json({ error: "Session not found" }, { status: 404 });
  }

  const body = (await request.json().catch(() => ({}))) as {
    answerText?: unknown;
    finish?: unknown;
    answerStartedAt?: unknown;
    revealedQuestionText?: unknown;
    qaDurationSec?: unknown;
    recordingId?: unknown;
    preferredNextQuestionId?: unknown;
  };
  const answerText = readAnswerText(body.answerText);
  const shouldFinish = body.finish === true;
  const answerStartedAt = readOptionalDate(body.answerStartedAt);
  const revealedQuestionText = body.revealedQuestionText === true;
  const clientQaDurationSec = readOptionalDuration(body.qaDurationSec);
  const recordingId = readOptionalId(body.recordingId);
  const preferredNextQuestionId = readOptionalId(body.preferredNextQuestionId);
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

  const existingAnswer = await prisma.trainingAnswer.findUnique({
    where: {
      questionId,
    },
    select: {
      recordingId: true,
    },
  });

  if (recordingId && !existingAnswer?.recordingId) {
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

  const now = new Date();
  const startedAt = answerStartedAt ?? now;
  const durationSec = getDurationSec(startedAt, now);

  const savedAnswer = await prisma.$transaction(async (transaction) => {
    const stateGuard = await transaction.trainingSession.updateMany({
      where: { id: sessionId, status: "QAING" },
      data: { updatedAt: now },
    });
    if (stateGuard.count === 0) {
      return null;
    }

    const answer = await transaction.trainingAnswer.upsert({
      where: {
        questionId,
      },
      update: revealedQuestionText
        ? {
            revealedQuestionText: true,
          }
        : {},
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
      select: {
        id: true,
        questionId: true,
        answerText: true,
        revealedQuestionText: true,
        recordingId: true,
        startedAt: true,
        endedAt: true,
        durationSec: true,
      },
    });

    if (recordingId && !answer.recordingId) {
      await transaction.trainingAnswer.updateMany({
        where: {
          id: answer.id,
          recordingId: null,
        },
        data: {
          recordingId,
        },
      });
    }

    const existingAnswerText = answer.answerText?.trim() ?? "";
    if (answerText && answerText.length > existingAnswerText.length) {
      await transaction.trainingAnswer.updateMany({
        where: {
          id: answer.id,
          answerText: answer.answerText,
        },
        data: {
          answerText,
        },
      });
    }

    return transaction.trainingAnswer.findUniqueOrThrow({
      where: {
        id: answer.id,
      },
      select: {
        id: true,
        questionId: true,
        answerText: true,
        revealedQuestionText: true,
        recordingId: true,
        startedAt: true,
        endedAt: true,
        durationSec: true,
      },
    });
  });

  if (!savedAnswer) {
    return NextResponse.json(
      { error: "训练状态已变化，回答未保存。" },
      { status: 409 },
    );
  }

  let nextQuestion: { id: string; orderIndex: number } | null = null;

  if (!shouldFinish && preferredNextQuestionId) {
    nextQuestion = await prisma.trainingQuestion.findFirst({
      where: {
        id: preferredNextQuestionId,
        sessionId,
        orderIndex: {
          gt: question.orderIndex,
        },
      },
      select: {
        id: true,
        orderIndex: true,
      },
    });

    if (!nextQuestion) {
      return NextResponse.json(
        { error: "指定的下一题不存在或不能进入。" },
        { status: 400 },
      );
    }
  }

  if (!shouldFinish && !nextQuestion) {
    nextQuestion = await prisma.trainingQuestion.findFirst({
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
  }

  if (!nextQuestion) {
    const finishResult = await finishQa(sessionId, now, clientQaDurationSec);

    if (!finishResult.updated || !finishResult.session) {
      return NextResponse.json(
        {
          error: "训练状态已变化，答辩未被重复结束。",
          session: finishResult.session,
        },
        { status: 409 },
      );
    }

    return NextResponse.json({
      completed: true,
      answer: savedAnswer,
      session: {
        ...finishResult.session,
        qaEndedAt: finishResult.session.qaEndedAt?.toISOString() ?? null,
      },
    });
  }

  return NextResponse.json({
    completed: false,
    answer: savedAnswer,
    nextQuestionId: nextQuestion.id,
    nextOrderIndex: nextQuestion.orderIndex,
  });
}
