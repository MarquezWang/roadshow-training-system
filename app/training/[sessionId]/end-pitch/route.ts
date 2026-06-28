import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { isSessionOwnedByCurrentUser } from "@/lib/auth-server";

type EndPitchRouteContext = Readonly<{
  params: Promise<{
    sessionId: string;
  }>;
}>;

const pitchAlreadyEndedStatuses = new Set([
  "PITCH_ENDED",
  "QA_READY",
  "QAING",
  "QA_ENDED",
  "ANALYZING",
  "REPORT_READY",
  "FINISHED",
]);

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
      pitchEndedAt: true,
      pitchDurationSec: true,
      currentPageIndex: true,
    },
  });

  if (!session) {
    return NextResponse.json({ error: "训练场次不存在。" }, { status: 404 });
  }

  if (pitchAlreadyEndedStatuses.has(session.status)) {
    return NextResponse.json({
      ok: true,
      skipped: true,
      reason: "pitch_already_ended",
      session: {
        id: session.id,
        status: session.status,
        pitchEndedAt: session.pitchEndedAt,
        pitchDurationSec: session.pitchDurationSec,
        currentPageIndex: session.currentPageIndex,
      },
    });
  }

  if (session.status === "ABORTED") {
    return NextResponse.json(
      {
        error: "当前训练已中止，不能结束路演。",
        reason: "training_aborted",
      },
      { status: 409 },
    );
  }

  if (session.status !== "PITCHING") {
    return NextResponse.json(
      {
        error: "当前训练状态不能结束路演。",
        reason: "pitch_not_started",
      },
      { status: 409 },
    );
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
  const result = await prisma.$transaction(async (transaction) => {
    const transition = await transaction.trainingSession.updateMany({
      where: {
        id: sessionId,
        status: "PITCHING",
      },
      data: {
        status: "QA_READY",
        pitchEndedAt: now,
        pitchDurationSec,
        currentPageIndex: endPageIndex,
      },
    });

    if (transition.count === 0) {
      const currentSession = await transaction.trainingSession.findUnique({
        where: {
          id: sessionId,
        },
        select: {
          id: true,
          status: true,
          pitchEndedAt: true,
          pitchDurationSec: true,
          currentPageIndex: true,
        },
      });

      return {
        updated: false,
        session: currentSession,
      };
    }

    await transaction.slideEvent.create({
      data: {
        sessionId,
        fileId,
        pageIndex: endPageIndex,
        eventType: "END",
        elapsedSec: pitchDurationSec,
      },
    });

    const updatedSession = await transaction.trainingSession.findUnique({
      where: {
        id: sessionId,
      },
      select: {
        id: true,
        status: true,
        pitchEndedAt: true,
        pitchDurationSec: true,
        currentPageIndex: true,
      },
    });

    return {
      updated: true,
      session: updatedSession,
    };
  });

  if (!result.session) {
    return NextResponse.json({ error: "训练场次不存在。" }, { status: 404 });
  }

  if (!result.updated) {
    if (pitchAlreadyEndedStatuses.has(result.session.status)) {
      return NextResponse.json({
        ok: true,
        skipped: true,
        reason: "pitch_already_ended",
        session: result.session,
      });
    }

    if (result.session.status === "ABORTED") {
      return NextResponse.json(
        {
          error: "当前训练已中止，不能结束路演。",
          reason: "training_aborted",
        },
        { status: 409 },
      );
    }

    return NextResponse.json(
      {
        error: "当前训练状态不能结束路演。",
        reason: "invalid_training_status",
      },
      { status: 409 },
    );
  }

  return NextResponse.json({
    session: result.session,
  });
}
