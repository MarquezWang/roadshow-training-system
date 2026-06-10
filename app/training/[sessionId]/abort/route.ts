import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { isAbortableTrainingStatus } from "@/lib/training-status";

type AbortTrainingRouteContext = Readonly<{
  params: Promise<{
    sessionId: string;
  }>;
}>;

export async function POST(_request: Request, context: AbortTrainingRouteContext) {
  const { sessionId } = await context.params;
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

  const updatedSession = await prisma.trainingSession.update({
    where: {
      id: sessionId,
    },
    data: {
      status: "ABORTED",
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
