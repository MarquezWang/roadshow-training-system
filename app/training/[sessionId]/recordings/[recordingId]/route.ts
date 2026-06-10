import { createReadStream } from "fs";
import { stat } from "fs/promises";
import path from "path";
import { Readable } from "stream";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

type RecordingPlaybackRouteContext = Readonly<{
  params: Promise<{
    sessionId: string;
    recordingId: string;
  }>;
}>;

async function resolveRecordingPath(filePath: string) {
  const normalizedPath = filePath.replaceAll("\\", "/");

  if (!normalizedPath.startsWith("uploads/training/")) {
    throw new Error("INVALID_RECORDING_PATH");
  }

  const uploadsRoot = path.resolve(process.cwd(), "uploads");
  const absolutePath = path.resolve(process.cwd(), normalizedPath);
  const relativeToUploads = path.relative(uploadsRoot, absolutePath);

  if (
    relativeToUploads.startsWith("..") ||
    path.isAbsolute(relativeToUploads)
  ) {
    throw new Error("INVALID_RECORDING_PATH");
  }

  const fileStat = await stat(absolutePath);

  if (!fileStat.isFile()) {
    throw new Error("FILE_NOT_FOUND");
  }

  return {
    absolutePath,
    size: fileStat.size,
  };
}

export async function GET(
  _request: Request,
  context: RecordingPlaybackRouteContext,
) {
  const { sessionId, recordingId } = await context.params;
  const recording = await prisma.trainingRecording.findFirst({
    where: {
      id: recordingId,
      sessionId,
    },
    select: {
      filePath: true,
      fileName: true,
      mimeType: true,
    },
  });

  if (!recording) {
    return NextResponse.json({ error: "录音不存在。" }, { status: 404 });
  }

  try {
    const { absolutePath, size } = await resolveRecordingPath(
      recording.filePath,
    );
    const stream = Readable.toWeb(createReadStream(absolutePath));

    return new Response(stream as ReadableStream<Uint8Array>, {
      headers: {
        "Content-Type": recording.mimeType,
        "Content-Length": String(size),
        "Cache-Control": "private, max-age=0",
        "Content-Disposition": `inline; filename*=UTF-8''${encodeURIComponent(
          recording.fileName,
        )}`,
      },
    });
  } catch {
    return NextResponse.json({ error: "录音文件不存在。" }, { status: 404 });
  }
}
