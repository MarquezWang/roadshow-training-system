import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

type EndPitchRouteContext = Readonly<{
  params: Promise<{
    sessionId: string;
  }>;
}>;

function readClientDuration(value: unknown) {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0) {
    return null;
  }

  return value;
}

export async function POST(
  request: NextRequest,
  context: EndPitchRouteContext,
) {
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

  const body = (await request.json().catch(() => ({}))) as {
    pitchDurationSec?: unknown;
  };
  const now = new Date();
  const serverDuration =
    session.pitchStartedAt === null
      ? null
      : Math.max(
          0,
          Math.round((now.getTime() - session.pitchStartedAt.getTime()) / 1000),
        );
  const pitchDurationSec =
    serverDuration ?? readClientDuration(body.pitchDurationSec) ?? 0;
  const updatedSession = await prisma.trainingSession.update({
    where: {
      id: sessionId,
    },
    data: {
      status: "PITCH_ENDED",
      pitchEndedAt: now,
      pitchDurationSec,
    },
    select: {
      id: true,
      status: true,
      pitchEndedAt: true,
      pitchDurationSec: true,
    },
  });

  return NextResponse.json({
    session: updatedSession,
  });
}
