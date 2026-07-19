import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { isSessionOwnedByCurrentUser } from "@/lib/auth-server";
import { readLimitedJson } from "@/lib/input-limits";

type TrainingEventRouteContext = Readonly<{
  params: Promise<{
    sessionId: string;
  }>;
}>;

const allowedEventTypes = new Set(["NEXT", "PREV", "JUMP"]);

function readInteger(value: unknown, fieldName: string) {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0) {
    throw new Error(`${fieldName} 必须是非负整数。`);
  }

  return value;
}

function readPageIndex(value: unknown) {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 1) {
    throw new Error("pageIndex 必须是大于 0 的整数。");
  }

  return value;
}

export async function POST(
  request: NextRequest,
  context: TrainingEventRouteContext,
) {
  const { sessionId } = await context.params;
  if (!(await isSessionOwnedByCurrentUser(sessionId))) {
    return NextResponse.json({ error: "Session not found" }, { status: 404 });
  }

  try {
    const body = await readLimitedJson<{
      eventType?: unknown;
      pageIndex?: unknown;
      elapsedSec?: unknown;
      fileId?: unknown;
    }>(request);
    const eventType =
      typeof body.eventType === "string" ? body.eventType.trim() : "";
    const pageIndex = readPageIndex(body.pageIndex);
    const elapsedSec = readInteger(body.elapsedSec, "elapsedSec");
    const fileId =
      typeof body.fileId === "string" && body.fileId.trim()
        ? body.fileId.trim()
        : null;

    if (!allowedEventTypes.has(eventType)) {
      return NextResponse.json(
        { error: `不支持的翻页事件类型：${eventType || "空"}` },
        { status: 400 },
      );
    }

    const session = await prisma.trainingSession.findUnique({
      where: {
        id: sessionId,
      },
      select: {
        id: true,
        projectId: true,
        status: true,
      },
    });

    if (!session) {
      return NextResponse.json({ error: "训练场次不存在。" }, { status: 404 });
    }

    if (session.status !== "PITCHING") {
      return NextResponse.json(
        { error: "只有路演中才能记录正式翻页事件。" },
        { status: 409 },
      );
    }

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

    const result = await prisma.$transaction(async (transaction) => {
      const transition = await transaction.trainingSession.updateMany({
        where: {
          id: sessionId,
          status: "PITCHING",
        },
        data: {
          currentPageIndex: pageIndex,
        },
      });

      if (transition.count === 0) {
        return null;
      }

      return transaction.slideEvent.create({
        data: {
          sessionId,
          fileId,
          pageIndex,
          eventType,
          elapsedSec,
        },
        select: {
          id: true,
        },
      });
    });

    if (!result) {
      return NextResponse.json(
        { error: "训练状态已变化，翻页事件未保存。" },
        { status: 409 },
      );
    }

    return NextResponse.json({
      eventId: result.id,
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "翻页事件记录失败。";

    return NextResponse.json({ error: message }, { status: 400 });
  }
}
