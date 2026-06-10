import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

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
  const project = await prisma.project.findUnique({
    where: {
      id,
    },
    select: {
      id: true,
    },
  });

  if (!project) {
    return NextResponse.json({ error: "项目不存在。" }, { status: 404 });
  }

  const session = await prisma.trainingSession.create({
    data: {
      projectId: id,
      status: "CREATED",
    },
    select: {
      id: true,
    },
  });

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
