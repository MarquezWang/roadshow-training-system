import { randomUUID } from "crypto";
import { mkdir, writeFile } from "fs/promises";
import path from "path";
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

type RecordingRouteContext = Readonly<{
  params: Promise<{
    sessionId: string;
  }>;
}>;

const maxRecordingSizeBytes = 100 * 1024 * 1024;
const allowedAudioTypes = new Map([
  ["audio/webm", "webm"],
  ["audio/mp4", "m4a"],
  ["audio/mpeg", "mp3"],
  ["audio/wav", "wav"],
  ["audio/x-wav", "wav"],
]);

function normalizeMimeType(mimeType: string) {
  return mimeType.split(";")[0]?.trim().toLowerCase() ?? "";
}

function readOptionalInteger(value: FormDataEntryValue | null) {
  if (typeof value !== "string" || value.trim() === "") {
    return null;
  }

  const parsed = Number(value);

  return Number.isInteger(parsed) && parsed >= 0 ? parsed : null;
}

function readOptionalDate(value: FormDataEntryValue | null) {
  if (typeof value !== "string" || value.trim() === "") {
    return null;
  }

  const parsed = new Date(value);

  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function readRecordingPhase(value: FormDataEntryValue | null) {
  if (typeof value !== "string") {
    return "PITCH";
  }

  const phase = value.trim().toUpperCase();

  return phase === "QA" ? "QA" : "PITCH";
}

function buildRecordingPath(sessionId: string, extension: string) {
  const safeFileName = `${randomUUID()}.${extension}`;
  const uploadRoot = path.resolve(process.cwd(), "uploads");
  const recordingDir = path.resolve(
    uploadRoot,
    "training",
    sessionId,
    "recordings",
  );
  const absolutePath = path.resolve(recordingDir, safeFileName);
  const relativeToUploads = path.relative(uploadRoot, absolutePath);

  if (
    relativeToUploads.startsWith("..") ||
    path.isAbsolute(relativeToUploads)
  ) {
    throw new Error("INVALID_RECORDING_PATH");
  }

  return {
    absolutePath,
    recordingDir,
    safeFileName,
    storedPath: path
      .join("uploads", relativeToUploads)
      .replaceAll(path.sep, "/"),
  };
}

export async function POST(
  request: NextRequest,
  context: RecordingRouteContext,
) {
  const { sessionId } = await context.params;
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

  const formData = await request.formData();
  const file = formData.get("file");

  if (!(file instanceof File)) {
    return NextResponse.json({ error: "缺少录音文件。" }, { status: 400 });
  }

  if (file.size <= 0) {
    return NextResponse.json({ error: "录音文件为空。" }, { status: 400 });
  }

  if (file.size > maxRecordingSizeBytes) {
    return NextResponse.json(
      { error: "录音文件超过 100MB 上限。" },
      { status: 413 },
    );
  }

  const mimeType = normalizeMimeType(file.type);
  const extension = allowedAudioTypes.get(mimeType);

  if (!extension) {
    return NextResponse.json(
      { error: "当前仅支持 webm、mp4、mp3、wav 音频。" },
      { status: 415 },
    );
  }

  try {
    const { absolutePath, recordingDir, safeFileName, storedPath } =
      buildRecordingPath(sessionId, extension);
    const bytes = Buffer.from(await file.arrayBuffer());

    await mkdir(recordingDir, { recursive: true });
    await writeFile(absolutePath, bytes);

    const recording = await prisma.trainingRecording.create({
      data: {
        sessionId,
        projectId: session.projectId,
        phase: readRecordingPhase(formData.get("phase")),
        status: "RECORDED",
        originalName: file.name || null,
        fileName: safeFileName,
        filePath: storedPath,
        mimeType,
        sizeBytes: file.size,
        durationSec: readOptionalInteger(formData.get("durationSec")),
        startedAt: readOptionalDate(formData.get("startedAt")),
        endedAt: readOptionalDate(formData.get("endedAt")),
      },
      select: {
        id: true,
        phase: true,
        status: true,
        fileName: true,
        mimeType: true,
        sizeBytes: true,
        durationSec: true,
        startedAt: true,
        endedAt: true,
      },
    });

    return NextResponse.json({
      recording: {
        ...recording,
        playbackUrl: `/training/${sessionId}/recordings/${recording.id}`,
      },
    });
  } catch {
    return NextResponse.json({ error: "录音文件保存失败。" }, { status: 500 });
  }
}
