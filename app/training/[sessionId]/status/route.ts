import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

type StatusRouteContext = Readonly<{
  params: Promise<{
    sessionId: string;
  }>;
}>;

export async function GET(
  _request: NextRequest,
  context: StatusRouteContext,
) {
  const { sessionId } = await context.params;
  const session = await prisma.trainingSession.findUnique({
    where: {
      id: sessionId,
    },
    select: {
      status: true,
    },
  });

  if (!session) {
    return NextResponse.json({ error: "Session not found" }, { status: 404 });
  }

  return NextResponse.json({ status: session.status });
}