import { NextRequest, NextResponse } from "next/server";
import { isSessionOwnedByCurrentUser } from "@/lib/auth-server";
import {
  InvalidJsonBodyError,
  MAX_ANSWER_TEXT_LENGTH,
  readLimitedJson,
  RequestBodyTooLargeError,
} from "@/lib/input-limits";
import { prisma } from "@/lib/prisma";
import { resolveQaDurationSec } from "@/lib/qa-duration";

type EndQaContext = Readonly<{
  params: Promise<{
    sessionId: string;
  }>;
}>;

function readNonEmptyText(value: unknown) {
  if (typeof value !== "string") {
    return null;
  }

  const text = value.trim();
  if (text.length > MAX_ANSWER_TEXT_LENGTH) {
    throw new Error(`答辩文本不能超过 ${MAX_ANSWER_TEXT_LENGTH} 个字符。`);
  }

  return text || null;
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
  if (!(await isSessionOwnedByCurrentUser(sessionId))) {
    return NextResponse.json({ error: "Session not found" }, { status: 404 });
  }

  let body: {
    questionId?: unknown;
    answerText?: unknown;
    revealedQuestionText?: unknown;
    qaDurationSec?: unknown;
    recordingId?: unknown;
  };

  try {
    body = await readLimitedJson(request);
  } catch (error) {
    const message =
      error instanceof RequestBodyTooLargeError ||
      error instanceof InvalidJsonBodyError
        ? error.message
        : "请求正文无效。";
    return NextResponse.json({ error: message }, { status: 400 });
  }
  const session = await prisma.trainingSession.findUnique({
    where: { id: sessionId },
    select: { id: true, status: true, qaStartedAt: true },
  });

  if (!session) {
    return NextResponse.json({ error: "训练场次不存在。" }, { status: 404 });
  }

  if (session.status !== "QAING") {
    return NextResponse.json(
      { error: "当前训练状态不能结束答辩。" },
      { status: 409 },
    );
  }

  const questionId = readOptionalId(body.questionId);
  const recordingId = readOptionalId(body.recordingId);
  let answerText: string | null;
  try {
    answerText = readNonEmptyText(body.answerText);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "答辩文本无效。" },
      { status: 400 },
    );
  }
  const revealedQuestionText = body.revealedQuestionText === true;

  if (questionId) {
    const question = await prisma.trainingQuestion.findFirst({
      where: { id: questionId, sessionId },
      select: { id: true },
    });
    if (!question) {
      return NextResponse.json({ error: "答辩问题不存在。" }, { status: 404 });
    }
  }

  if (recordingId) {
    if (!questionId) {
      return NextResponse.json(
        { error: "提交答辩录音时必须同时提供问题 ID。" },
        { status: 400 },
      );
    }

    const recording = await prisma.trainingRecording.findFirst({
      where: { id: recordingId, sessionId, phase: "QA" },
      select: {
        id: true,
        answer: { select: { questionId: true } },
      },
    });
    if (!recording || (recording.answer && recording.answer.questionId !== questionId)) {
      return NextResponse.json(
        { error: "答辩录音不存在、已被使用或不属于当前场次。" },
        { status: 400 },
      );
    }
  }

  const now = new Date();
  const qaDurationSec = resolveQaDurationSec(
    session.qaStartedAt,
    now,
    body.qaDurationSec,
  );
  const shouldSaveAnswer = Boolean(questionId);

  const result = await prisma.$transaction(async (transaction) => {
    const transition = await transaction.trainingSession.updateMany({
      where: { id: sessionId, status: "QAING" },
      data: {
        status: "QA_ENDED",
        qaEndedAt: now,
        qaDurationSec,
      },
    });

    if (transition.count === 0) {
      return {
        updated: false,
        session: await transaction.trainingSession.findUnique({
          where: { id: sessionId },
          select: { id: true, status: true, qaEndedAt: true, qaDurationSec: true },
        }),
      };
    }

    if (questionId && shouldSaveAnswer) {
      const existingAnswer = await transaction.trainingAnswer.findUnique({
        where: { questionId },
        select: {
          id: true,
          answerText: true,
          recordingId: true,
          revealedQuestionText: true,
          startedAt: true,
          endedAt: true,
        },
      });

      if (existingAnswer) {
        const existingText = existingAnswer.answerText?.trim() ?? "";
        const startedAt = existingAnswer.startedAt ?? now;
        await transaction.trainingAnswer.update({
          where: { id: existingAnswer.id },
          data: {
            ...(answerText && answerText.length > existingText.length
              ? { answerText }
              : {}),
            ...(recordingId && !existingAnswer.recordingId ? { recordingId } : {}),
            ...(revealedQuestionText && !existingAnswer.revealedQuestionText
              ? { revealedQuestionText: true }
              : {}),
            ...(!existingAnswer.endedAt
              ? {
                  startedAt,
                  endedAt: now,
                  durationSec: getDurationSec(startedAt, now),
                }
              : {}),
          },
        });
      } else {
        const startedAt = now;
        await transaction.trainingAnswer.create({
          data: {
            sessionId,
            questionId,
            answerText,
            revealedQuestionText,
            recordingId,
            startedAt,
            endedAt: now,
            durationSec: getDurationSec(startedAt, now),
          },
        });
      }
    }

    return {
      updated: true,
      session: await transaction.trainingSession.findUnique({
        where: { id: sessionId },
        select: { id: true, status: true, qaEndedAt: true, qaDurationSec: true },
      }),
    };
  });

  if (!result.session) {
    return NextResponse.json({ error: "训练场次不存在。" }, { status: 404 });
  }

  if (!result.updated) {
    return NextResponse.json(
      { error: "训练状态已变化，答辩未被重复结束。", session: result.session },
      { status: 409 },
    );
  }

  return NextResponse.json({
    session: {
      ...result.session,
      qaEndedAt: result.session.qaEndedAt?.toISOString() ?? null,
    },
  });
}
