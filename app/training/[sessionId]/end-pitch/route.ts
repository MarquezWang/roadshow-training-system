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

function readPageIndex(value: unknown) {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 1) {
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
      projectId: true,
      pitchStartedAt: true,
      currentPageIndex: true,
    },
  });

  if (!session) {
    return NextResponse.json({ error: "训练场次不存在。" }, { status: 404 });
  }

  const body = (await request.json().catch(() => ({}))) as {
    pitchDurationSec?: unknown;
    pageIndex?: unknown;
    fileId?: unknown;
  };
  const fileId =
    typeof body.fileId === "string" && body.fileId.trim()
      ? body.fileId.trim()
      : null;

  if (fileId) {
    const file = await prisma.fileAsset.findFirst({
      where: {
        id: fileId,
        projectId: session.projectId,
      },
      select: {
        id: true,
      },
    });

    if (!file) {
      return NextResponse.json(
        { error: "文件不存在或不属于当前训练项目。" },
        { status: 400 },
      );
    }
  }

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
  const endPageIndex =
    readPageIndex(body.pageIndex) ?? Math.max(1, session.currentPageIndex);
  const [updatedSession] = await prisma.$transaction([
    prisma.trainingSession.update({
      where: {
        id: sessionId,
      },
      data: {
        status: "PITCH_ENDED",
        pitchEndedAt: now,
        pitchDurationSec,
        currentPageIndex: endPageIndex,
      },
      select: {
        id: true,
        status: true,
        pitchEndedAt: true,
        pitchDurationSec: true,
        currentPageIndex: true,
      },
    }),
    prisma.slideEvent.create({
      data: {
        sessionId,
        fileId,
        pageIndex: endPageIndex,
        eventType: "END",
        elapsedSec: pitchDurationSec,
      },
    }),
  ]);

  return NextResponse.json({
    session: updatedSession,
  });
}
