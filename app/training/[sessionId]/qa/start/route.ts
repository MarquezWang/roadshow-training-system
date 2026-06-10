import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

type StartQaContext = Readonly<{
  params: Promise<{
    sessionId: string;
  }>;
}>;

const allowedStatuses = new Set(["PITCH_ENDED", "QA_READY", "QAING"]);

export async function POST(_request: Request, context: StartQaContext) {
  const { sessionId } = await context.params;
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

  if (!allowedStatuses.has(session.status)) {
    return NextResponse.json(
      { error: "当前训练状态不能开始答辩。" },
      { status: 400 },
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
  const updatedSession = await prisma.trainingSession.update({
    where: {
      id: sessionId,
    },
    data: {
      status: "QAING",
      qaStartedAt,
      qaEndedAt: null,
      qaDurationSec: null,
    },
    select: {
      id: true,
      status: true,
      qaStartedAt: true,
    },
  });

  return NextResponse.json({
    session: {
      ...updatedSession,
      qaStartedAt: updatedSession.qaStartedAt?.toISOString() ?? null,
    },
  });
}
