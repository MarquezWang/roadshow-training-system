import { createReadStream } from "node:fs";
import { stat } from "fs/promises";
import { Readable } from "node:stream";
import path from "path";
import { NextResponse } from "next/server";
import { isSessionOwnedByCurrentUser } from "@/lib/auth-server";
import { prisma } from "@/lib/prisma";

type RecordingPlaybackRouteContext = Readonly<{
  params: Promise<{
    sessionId: string;
    recordingId: string;
  }>;
}>;

async function resolveRecordingPath(filePath: string) {
  const normalizedPath = filePath.replaceAll("\\", "/");
  const recordingPrefix = "uploads/training/";

  if (!normalizedPath.startsWith(recordingPrefix)) {
    throw new Error("INVALID_RECORDING_PATH");
  }

  const trainingUploadsRoot = path.join(
    /* turbopackIgnore: true */ process.cwd(),
    "uploads",
    "training",
  );
  const absolutePath = path.resolve(
    trainingUploadsRoot,
    normalizedPath.slice(recordingPrefix.length),
  );
  const relativeToTrainingUploads = path.relative(
    trainingUploadsRoot,
    absolutePath,
  );

  if (
    relativeToTrainingUploads.startsWith("..") ||
    path.isAbsolute(relativeToTrainingUploads)
  ) {
    throw new Error("INVALID_RECORDING_PATH");
  }

  const fileStat = await stat(/* turbopackIgnore: true */ absolutePath);

  if (!fileStat.isFile()) {
    throw new Error("FILE_NOT_FOUND");
  }

  return {
    absolutePath,
    size: fileStat.size,
  };
}

function parseRangeHeader(rangeHeader: string | null, size: number) {
  if (!rangeHeader) {
    return null;
  }

  const match = rangeHeader.match(/^bytes=(\d*)-(\d*)$/);

  if (!match) {
    return null;
  }

  const [, startText, endText] = match;

  if (!startText && !endText) {
    return null;
  }

  if (!startText) {
    const suffixLength = Number(endText);

    if (!Number.isInteger(suffixLength) || suffixLength <= 0) {
      return null;
    }

    return {
      start: Math.max(0, size - suffixLength),
      end: size - 1,
    };
  }

  const start = Number(startText);
  const end = endText ? Number(endText) : size - 1;

  if (
    !Number.isInteger(start) ||
    !Number.isInteger(end) ||
    start < 0 ||
    end < start ||
    start >= size
  ) {
    return null;
  }

  return {
    start,
    end: Math.min(end, size - 1),
  };
}

export async function GET(
  request: Request,
  context: RecordingPlaybackRouteContext,
) {
  const { sessionId, recordingId } = await context.params;
  if (!(await isSessionOwnedByCurrentUser(sessionId))) {
    return NextResponse.json({ error: "Session not found" }, { status: 404 });
  }

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
    const range = parseRangeHeader(request.headers.get("range"), size);
    const baseHeaders = {
      "Content-Type": recording.mimeType,
      "Accept-Ranges": "bytes",
      "Cache-Control": "private, max-age=0",
      "Content-Disposition": `inline; filename*=UTF-8''${encodeURIComponent(
        recording.fileName,
      )}`,
    };

    if (request.headers.get("range") && !range) {
      return new Response(null, {
        status: 416,
        headers: {
          ...baseHeaders,
          "Content-Range": `bytes */${size}`,
        },
      });
    }

    if (range) {
      const contentLength = range.end - range.start + 1;
      const body = Readable.toWeb(
        createReadStream(/* turbopackIgnore: true */ absolutePath, {
          start: range.start,
          end: range.end,
        }),
      );

      return new Response(body as BodyInit, {
        status: 206,
        headers: {
          ...baseHeaders,
          "Content-Length": String(contentLength),
          "Content-Range": `bytes ${range.start}-${range.end}/${size}`,
        },
      });
    }

    const body = Readable.toWeb(
      createReadStream(/* turbopackIgnore: true */ absolutePath),
    );
    return new Response(body as BodyInit, {
      headers: {
        ...baseHeaders,
        "Content-Length": String(size),
      },
    });
  } catch {
    return NextResponse.json({ error: "录音文件不存在。" }, { status: 404 });
  }
}
