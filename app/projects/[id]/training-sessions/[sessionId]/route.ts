import path from "path";
import { NextResponse } from "next/server";
import { getCurrentAccessUserId } from "@/lib/auth-server";
import { stageUploadEntries } from "@/lib/file-lifecycle.mjs";
import { prisma } from "@/lib/prisma";

type TrainingSessionDeleteRouteContext = Readonly<{
  params: Promise<{
    id: string;
    sessionId: string;
  }>;
}>;

function resolveStoredUploadPath(filePath: string) {
  const normalizedPath = filePath.replaceAll("\\", "/");

  if (!normalizedPath.startsWith("uploads/")) {
    return null;
  }

  const uploadRoot = path.resolve(
    /* turbopackIgnore: true */ process.cwd(),
    "uploads",
  );
  const absolutePath = path.resolve(
    /* turbopackIgnore: true */ uploadRoot,
    normalizedPath.slice("uploads/".length),
  );
  const relativeToUploads = path.relative(uploadRoot, absolutePath);

  if (
    relativeToUploads.startsWith("..") ||
    path.isAbsolute(relativeToUploads)
  ) {
    return null;
  }

  return absolutePath;
}

export async function DELETE(
  _request: Request,
  context: TrainingSessionDeleteRouteContext,
) {
  const { id: projectId, sessionId } = await context.params;
  const userId = await getCurrentAccessUserId();
  const session = await prisma.trainingSession.findFirst({
    where: userId
      ? {
          id: sessionId,
          projectId,
          project: {
            ownerId: userId,
          },
        }
      : {
          id: sessionId,
          projectId,
        },
    select: {
      id: true,
      recordings: {
        select: {
          filePath: true,
        },
      },
    },
  });

  if (!session) {
    return NextResponse.json({ error: "训练记录不存在。" }, { status: 404 });
  }

  const recordingPaths = session.recordings
    .map((recording) => resolveStoredUploadPath(recording.filePath))
    .filter((filePath): filePath is string => filePath !== null);

  const safeSessionId = session.id.replace(/[^a-zA-Z0-9_-]/g, "");
  const sessionDirectory =
    safeSessionId && safeSessionId === session.id
      ? path.resolve(
          /* turbopackIgnore: true */ process.cwd(),
          "uploads",
          "training",
          safeSessionId,
        )
      : null;
  let staged: Awaited<ReturnType<typeof stageUploadEntries>>;
  try {
    staged = await stageUploadEntries({
      workspaceRoot: /* turbopackIgnore: true */ process.cwd(),
      paths: [sessionDirectory, ...recordingPaths].filter(
        (value): value is string => Boolean(value),
      ),
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "训练记录删除失败。" },
      { status: 500 },
    );
  }
  if (staged.contendedCount > 0) {
    await staged.rollback();
    return NextResponse.json(
      { error: "该训练记录正在被其他删除请求处理。" },
      { status: 409 },
    );
  }

  try {
    await prisma.trainingSession.deleteMany({ where: { id: session.id } });
  } catch (error) {
    await staged.rollback();
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "训练记录删除失败。" },
      { status: 500 },
    );
  }

  await staged.commit();
  return NextResponse.json({ deleted: true });
}
