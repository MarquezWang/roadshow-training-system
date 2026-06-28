import { NextRequest, NextResponse } from "next/server";
import { getCurrentAccessUserId, withOwnerFilter } from "@/lib/auth-server";
import { prisma } from "@/lib/prisma";
import { abortableTrainingStatuses } from "@/lib/training-status";

type TrainingSessionRouteContext = Readonly<{
  params: Promise<{
    id: string;
  }>;
}>;

export async function POST(
  request: NextRequest,
  context: TrainingSessionRouteContext,
) {
  const { id } = await context.params;
  const userId = await getCurrentAccessUserId();
  const project = await prisma.project.findFirst({
    where: withOwnerFilter({ id }, userId),
    select: {
      id: true,
    },
  });

  if (!project) {
    return NextResponse.json({ error: "项目不存在。" }, { status: 404 });
  }

  const [, session] = await prisma.$transaction([
    prisma.trainingSession.updateMany({
      where: {
        projectId: id,
        status: {
          in: [...abortableTrainingStatuses],
        },
      },
      data: {
        status: "ABORTED",
      },
    }),
    prisma.trainingSession.create({
      data: {
        projectId: id,
        status: "CREATED",
      },
      select: {
        id: true,
      },
    }),
  ]);

  if (request.nextUrl.searchParams.get("redirect") === "1") {
    return NextResponse.redirect(
      new URL(`/training/${session.id}/prepare`, request.url),
      303,
    );
  }

  return NextResponse.json({
    sessionId: session.id,
  });
}
