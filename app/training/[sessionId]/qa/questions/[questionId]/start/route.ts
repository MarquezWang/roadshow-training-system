import { NextResponse } from "next/server";
import { isSessionOwnedByCurrentUser } from "@/lib/auth-server";
import { prisma } from "@/lib/prisma";

type StartTrainingAnswerContext = Readonly<{
  params: Promise<{
    sessionId: string;
    questionId: string;
  }>;
}>;

export async function POST(
  _request: Request,
  context: StartTrainingAnswerContext,
) {
  const { sessionId, questionId } = await context.params;
  if (!(await isSessionOwnedByCurrentUser(sessionId))) {
    return NextResponse.json({ error: "Session not found" }, { status: 404 });
  }

  const question = await prisma.trainingQuestion.findFirst({
    where: { id: questionId, sessionId },
    select: { id: true },
  });
  if (!question) {
    return NextResponse.json({ error: "答辩问题不存在。" }, { status: 404 });
  }

  const now = new Date();
  const answer = await prisma.$transaction(async (transaction) => {
    const stateGuard = await transaction.trainingSession.updateMany({
      where: { id: sessionId, status: "QAING" },
      data: { updatedAt: now },
    });
    if (stateGuard.count !== 1) return null;

    await transaction.trainingAnswer.upsert({
      where: { questionId },
      update: {},
      create: {
        sessionId,
        questionId,
        startedAt: now,
      },
    });
    await transaction.trainingAnswer.updateMany({
      where: {
        questionId,
        startedAt: null,
        endedAt: null,
      },
      data: { startedAt: now },
    });

    return transaction.trainingAnswer.findUniqueOrThrow({
      where: { questionId },
      select: {
        startedAt: true,
      },
    });
  });

  if (!answer) {
    return NextResponse.json(
      { error: "当前训练状态不能开始本题回答。" },
      { status: 409 },
    );
  }
  return NextResponse.json({
    startedAt: answer.startedAt?.toISOString() ?? now.toISOString(),
  });
}
