import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { isSessionOwnedByCurrentUser } from "@/lib/auth-server";

type StartPitchRouteContext = Readonly<{
  params: Promise<{
    sessionId: string;
  }>;
}>;

export async function POST(
  request: NextRequest,
  context: StartPitchRouteContext,
) {
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
      projectId: true,
      status: true,
      pitchStartedAt: true,
      currentPageIndex: true,
    },
  });

  if (!session) {
    return NextResponse.json({ error: "训练场次不存在。" }, { status: 404 });
  }

  if (session.status === "PITCHING") {
    return NextResponse.json({
      session: {
        id: session.id,
        status: session.status,
        pitchStartedAt: session.pitchStartedAt,
        currentPageIndex: session.currentPageIndex,
      },
    });
  }

  if (session.status !== "CREATED" && session.status !== "PITCH_READY") {
    return NextResponse.json(
      { error: "当前训练状态不能开始路演。" },
      { status: 400 },
    );
  }

  const body = (await request.json().catch(() => ({}))) as {
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

  const pitchStartedAt = new Date();
  const [updatedSession] = await prisma.$transaction([
    prisma.trainingSession.update({
      where: {
        id: sessionId,
      },
      data: {
        status: "PITCHING",
        pitchStartedAt,
        pitchEndedAt: null,
        pitchDurationSec: null,
        currentPageIndex: 1,
      },
      select: {
        id: true,
        status: true,
        pitchStartedAt: true,
        currentPageIndex: true,
      },
    }),
    prisma.slideEvent.create({
      data: {
        sessionId,
        fileId,
        pageIndex: 1,
        eventType: "START",
        elapsedSec: 0,
      },
    }),
  ]);

  return NextResponse.json({
    session: updatedSession,
  });
}
