import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

type EndQaContext = Readonly<{
  params: Promise<{
    sessionId: string;
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

export async function POST(request: NextRequest, context: EndQaContext) {
  const { sessionId } = await context.params;
  const body = (await request.json().catch(() => ({}))) as {
    questionId?: unknown;
    answerText?: unknown;
    answerStartedAt?: unknown;
    revealedQuestionText?: unknown;
    qaDurationSec?: unknown;
    recordingId?: unknown;
  };
  const session = await prisma.trainingSession.findUnique({
    where: {
      id: sessionId,
    },
    select: {
      id: true,
      status: true,
      qaStartedAt: true,
    },
  });

  if (!session) {
    return NextResponse.json({ error: "训练场次不存在。" }, { status: 404 });
  }

  if (session.status !== "QAING") {
    return NextResponse.json(
      { error: "当前训练状态不能结束答辩。" },
      { status: 400 },
    );
  }

  const now = new Date();
  const answerStartedAt = readOptionalDate(body.answerStartedAt);
  const revealedQuestionText = body.revealedQuestionText === true;
  const recordingId = readOptionalId(body.recordingId);
  const questionId =
    typeof body.questionId === "string" && body.questionId.trim()
      ? body.questionId.trim()
      : null;

  if (questionId) {
    const question = await prisma.trainingQuestion.findFirst({
      where: {
        id: questionId,
        sessionId,
      },
      select: {
        id: true,
      },
    });

    if (question) {
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
            { error: "答辩录音不存在或不属于当前场次。" },
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
      const startedAt = existingAnswer?.startedAt ?? answerStartedAt ?? now;

      await prisma.trainingAnswer.upsert({
        where: {
          questionId,
        },
        update: {
          answerText: readAnswerText(body.answerText),
          revealedQuestionText,
          recordingId,
          startedAt,
          endedAt: now,
          durationSec: getDurationSec(startedAt, now),
        },
        create: {
          sessionId,
          questionId,
          answerText: readAnswerText(body.answerText),
          revealedQuestionText,
          recordingId,
          startedAt,
          endedAt: now,
          durationSec: getDurationSec(startedAt, now),
        },
      });
    }
  }

  const qaDurationSec =
    readOptionalDuration(body.qaDurationSec) ??
    (session.qaStartedAt
      ? Math.max(
          0,
          Math.round((now.getTime() - session.qaStartedAt.getTime()) / 1000),
        )
      : null);
  const updatedSession = await prisma.trainingSession.update({
    where: {
      id: sessionId,
    },
    data: {
      status: "QA_ENDED",
      qaEndedAt: now,
      qaDurationSec,
    },
    select: {
      id: true,
      status: true,
      qaEndedAt: true,
      qaDurationSec: true,
    },
  });

  return NextResponse.json({
    session: {
      ...updatedSession,
      qaEndedAt: updatedSession.qaEndedAt?.toISOString() ?? null,
    },
  });
}
