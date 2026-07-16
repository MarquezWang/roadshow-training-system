import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { isSessionOwnedByCurrentUser } from "@/lib/auth-server";

type ReadyRouteContext = Readonly<{
  params: Promise<{
    sessionId: string;
  }>;
}>;

export async function POST(_request: Request, context: ReadyRouteContext) {
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
    },
  });

  if (!session) {
    return NextResponse.json({ error: "训练场次不存在。" }, { status: 404 });
  }

  if (session.status === "PITCH_READY") {
    return NextResponse.json({
      session,
    });
  }

  if (session.status !== "CREATED") {
    return NextResponse.json(
      { error: "当前训练状态不能进入路演准备。" },
      { status: 409 },
    );
  }

  const transition = await prisma.trainingSession.updateMany({
    where: {
      id: sessionId,
      status: "CREATED",
    },
    data: {
      status: "PITCH_READY",
    },
  });
  const updatedSession = await prisma.trainingSession.findUnique({
    where: { id: sessionId },
    select: {
      id: true,
      status: true,
    },
  });

  if (!updatedSession) {
    return NextResponse.json({ error: "训练场次不存在。" }, { status: 404 });
  }

  if (transition.count === 0 && updatedSession.status !== "PITCH_READY") {
    return NextResponse.json(
      { error: "训练状态已变化，请刷新后重试。", session: updatedSession },
      { status: 409 },
    );
  }

  return NextResponse.json({
    session: updatedSession,
  });
}
