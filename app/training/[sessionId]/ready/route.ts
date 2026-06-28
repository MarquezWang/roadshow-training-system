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

  if (session.status !== "CREATED" && session.status !== "PITCH_READY") {
    return NextResponse.json({
      session,
    });
  }

  const updatedSession = await prisma.trainingSession.update({
    where: {
      id: sessionId,
    },
    data: {
      status: "PITCH_READY",
    },
    select: {
      id: true,
      status: true,
    },
  });

  return NextResponse.json({
    session: updatedSession,
  });
}
