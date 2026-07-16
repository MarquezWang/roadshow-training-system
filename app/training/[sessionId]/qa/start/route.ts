import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { isSessionOwnedByCurrentUser } from "@/lib/auth-server";
import { qaStartableTrainingStatuses } from "@/lib/training-status";

type StartQaContext = Readonly<{
  params: Promise<{
    sessionId: string;
  }>;
}>;

export async function POST(_request: Request, context: StartQaContext) {
  const { sessionId } = await context.params;
  if (!(await isSessionOwnedByCurrentUser(sessionId))) {
    return NextResponse.json({ error: "Session not found" }, { status: 404 });
  }
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

  if (session.status === "QAING") {
    return NextResponse.json({
      session: {
        ...session,
        qaStartedAt: session.qaStartedAt?.toISOString() ?? null,
      },
      skipped: true,
    });
  }

  if (
    !qaStartableTrainingStatuses.includes(
      session.status as (typeof qaStartableTrainingStatuses)[number],
    )
  ) {
    return NextResponse.json(
      { error: "当前训练状态不能开始答辩。" },
      { status: 409 },
    );
  }

  const questions = await prisma.trainingQuestion.findMany({
    where: {
      sessionId,
    },
    orderBy: {
      orderIndex: "asc",
    },
    select: {
      id: true,
    },
  });

  if (questions.length === 0) {
    return NextResponse.json(
      { error: "请先生成答辩问题后再开始答辩。" },
      { status: 400 },
    );
  }

  const now = new Date();
  const qaStartedAt = session.qaStartedAt ?? now;
  const transition = await prisma.trainingSession.updateMany({
    where: {
      id: sessionId,
      status: { in: [...qaStartableTrainingStatuses] },
    },
    data: {
      status: "QAING",
      qaStartedAt,
      qaEndedAt: null,
      qaDurationSec: null,
    },
  });
  const updatedSession = await prisma.trainingSession.findUnique({
    where: { id: sessionId },
    select: { id: true, status: true, qaStartedAt: true },
  });

  if (!updatedSession) {
    return NextResponse.json({ error: "训练场次不存在。" }, { status: 404 });
  }

  if (transition.count === 0 && updatedSession.status !== "QAING") {
    return NextResponse.json(
      { error: "训练状态已变化，不能开始答辩。", session: updatedSession },
      { status: 409 },
    );
  }

  return NextResponse.json({
    session: {
      ...updatedSession,
      qaStartedAt: updatedSession.qaStartedAt?.toISOString() ?? null,
    },
    skipped: transition.count === 0,
  });
}
