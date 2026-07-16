import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import {
  abortableTrainingStatuses,
  isAbortableTrainingStatus,
  isTerminalTrainingStatus,
} from "@/lib/training-status";
import { isSessionOwnedByCurrentUser } from "@/lib/auth-server";

type AbortTrainingRouteContext = Readonly<{
  params: Promise<{
    sessionId: string;
  }>;
}>;

export async function POST(_request: Request, context: AbortTrainingRouteContext) {
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

  if (!isAbortableTrainingStatus(session.status)) {
    return NextResponse.json({
      session,
    });
  }

  const transition = await prisma.trainingSession.updateMany({
    where: {
      id: sessionId,
      status: { in: [...abortableTrainingStatuses] },
    },
    data: {
      status: "ABORTED",
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

  if (transition.count === 0 && !isTerminalTrainingStatus(updatedSession.status)) {
    return NextResponse.json(
      { error: "训练状态已变化，不能中止。", session: updatedSession },
      { status: 409 },
    );
  }

  return NextResponse.json({
    session: updatedSession,
    skipped: transition.count === 0,
  });
}
