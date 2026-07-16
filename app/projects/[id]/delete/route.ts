import path from "node:path";
import { NextResponse } from "next/server";
import { getCurrentAccessUserId, withOwnerFilter } from "@/lib/auth-server";
import { stageUploadEntries } from "@/lib/file-lifecycle.mjs";
import { prisma } from "@/lib/prisma";

function safeSegment(value: string) {
  return value.replace(/[^a-zA-Z0-9_-]/g, "");
}

export async function POST(
  _request: Request,
  context: Readonly<{ params: Promise<{ id: string }> }>,
) {
  const { id } = await context.params;
  const userId = await getCurrentAccessUserId();
  const project = await prisma.project.findFirst({
    where: withOwnerFilter({ id }, userId),
    select: {
      id: true,
      trainingSessions: { select: { id: true } },
    },
  });

  if (!project) {
    return NextResponse.json({ error: "项目不存在。" }, { status: 404 });
  }

  const uploadsRoot = path.resolve(process.cwd(), "uploads");
  const safeProjectId = safeSegment(project.id);
  if (!safeProjectId || safeProjectId !== project.id) {
    return NextResponse.json({ error: "项目文件路径无效。" }, { status: 500 });
  }
  const candidates = [
    path.join(uploadsRoot, "projects", safeProjectId),
    ...project.trainingSessions.flatMap((session) => {
      const safeSessionId = safeSegment(session.id);
      return safeSessionId && safeSessionId === session.id
        ? [path.join(uploadsRoot, "training", safeSessionId)]
        : [];
    }),
  ];
  let staged: Awaited<ReturnType<typeof stageUploadEntries>>;

  try {
    staged = await stageUploadEntries({
      workspaceRoot: process.cwd(),
      paths: candidates,
    });
  } catch (error) {
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "项目删除失败。",
      },
      { status: 500 },
    );
  }
  if (staged.contendedCount > 0) {
    await staged.rollback();
    return NextResponse.json(
      { error: "项目文件正在被其他删除请求处理。" },
      { status: 409 },
    );
  }

  try {
    await prisma.project.deleteMany({ where: { id: project.id } });
  } catch (error) {
    await staged.rollback();
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "项目删除失败。" },
      { status: 500 },
    );
  }

  await staged.commit();
  return NextResponse.json({ deleted: true });
}
