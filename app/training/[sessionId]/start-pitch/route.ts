import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

type StartPitchRouteContext = Readonly<{
  params: Promise<{
    sessionId: string;
  }>;
}>;

export async function POST(_request: Request, context: StartPitchRouteContext) {
  const { sessionId } = await context.params;
  const session = await prisma.trainingSession.findUnique({
    where: {
      id: sessionId,
    },
    select: {
      id: true,
      pitchStartedAt: true,
    },
  });

  if (!session) {
    return NextResponse.json({ error: "训练场次不存在。" }, { status: 404 });
  }

  const pitchStartedAt = session.pitchStartedAt ?? new Date();
  const updatedSession = await prisma.trainingSession.update({
    where: {
      id: sessionId,
    },
    data: {
      status: "PITCHING",
      pitchStartedAt,
      pitchEndedAt: null,
      pitchDurationSec: null,
    },
    select: {
      id: true,
      status: true,
      pitchStartedAt: true,
    },
  });

  return NextResponse.json({
    session: updatedSession,
  });
}
