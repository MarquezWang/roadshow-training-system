import { rm } from "fs/promises";
import path from "path";
import { NextResponse } from "next/server";
import { getCurrentAccessUserId } from "@/lib/auth-server";
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

  const uploadRoot = path.resolve(process.cwd(), "uploads");
  const absolutePath = path.resolve(process.cwd(), normalizedPath);
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

  await prisma.trainingSession.delete({
    where: {
      id: session.id,
    },
  });

  await Promise.all(
    recordingPaths.map((filePath) =>
      rm(filePath, { force: true }).catch(() => undefined),
    ),
  );

  return NextResponse.json({ deleted: true });
}
