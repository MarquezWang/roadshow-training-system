import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

type TrainingEventRouteContext = Readonly<{
  params: Promise<{
    sessionId: string;
  }>;
}>;

const allowedEventTypes = new Set(["START", "NEXT", "PREV", "JUMP", "END"]);

function readInteger(value: unknown, fieldName: string) {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0) {
    throw new Error(`${fieldName} 必须是非负整数。`);
  }

  return value;
}

export async function POST(
  request: NextRequest,
  context: TrainingEventRouteContext,
) {
  const { sessionId } = await context.params;

  try {
    const body = (await request.json()) as {
      eventType?: unknown;
      pageIndex?: unknown;
      elapsedSec?: unknown;
      fileId?: unknown;
    };
    const eventType =
      typeof body.eventType === "string" ? body.eventType.trim() : "";
    const pageIndex = readInteger(body.pageIndex, "pageIndex");
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
      },
    });

    if (!session) {
      return NextResponse.json({ error: "训练场次不存在。" }, { status: 404 });
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

    const slideEvent = await prisma.slideEvent.create({
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

    await prisma.trainingSession.update({
      where: {
        id: sessionId,
      },
      data: {
        currentPageIndex: pageIndex,
      },
    });

    return NextResponse.json({
      eventId: slideEvent.id,
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "翻页事件记录失败。";

    return NextResponse.json({ error: message }, { status: 400 });
  }
}
