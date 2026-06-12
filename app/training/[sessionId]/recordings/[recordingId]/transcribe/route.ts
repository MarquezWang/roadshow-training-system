import { existsSync } from "fs";
import path from "path";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { transcribeAudio } from "@/lib/transcription";

type TranscribeRouteContext = Readonly<{
  params: Promise<{
    sessionId: string;
    recordingId: string;
  }>;
}>;

export async function POST(
  _request: Request,
  context: TranscribeRouteContext,
) {
  const { sessionId, recordingId } = await context.params;

  const recording = await prisma.trainingRecording.findFirst({
    where: {
      id: recordingId,
      sessionId,
    },
    select: {
      id: true,
      sessionId: true,
      projectId: true,
      phase: true,
      filePath: true,
      mimeType: true,
      transcript: {
        select: {
          id: true,
          status: true,
          text: true,
        },
      },
    },
  });

  if (!recording) {
    return NextResponse.json({ error: "录音不存在。" }, { status: 404 });
  }

  if (recording.phase !== "PITCH") {
    return NextResponse.json(
      { error: "仅支持转写 PITCH 阶段录音。" },
      { status: 400 },
    );
  }

  if (!recording.filePath) {
    return NextResponse.json(
      { error: "录音文件路径为空。" },
      { status: 400 },
    );
  }

  const absolutePath = path.resolve(process.cwd(), recording.filePath);

  if (!existsSync(absolutePath)) {
    return NextResponse.json(
      { error: "录音文件不存在，请重新录制。" },
      { status: 400 },
    );
  }

  const now = new Date();

  await prisma.trainingTranscript.upsert({
    where: {
      recordingId,
    },
    create: {
      recordingId,
      sessionId: recording.sessionId,
      projectId: recording.projectId,
      status: "PENDING",
      source: "ASR_PROVIDER",
      language: "zh-CN",
      text: "",
      startedAt: now,
    },
    update: {
      status: "PENDING",
      source: "ASR_PROVIDER",
      language: "zh-CN",
      text: "",
      errorMessage: null,
      startedAt: now,
      completedAt: null,
    },
  });

  try {
    const text = await transcribeAudio(absolutePath, recording.mimeType);
    const completedAt = new Date();

    const updated = await prisma.trainingTranscript.update({
      where: {
        recordingId,
      },
      data: {
        status: "COMPLETED",
        text,
        completedAt,
        errorMessage: null,
      },
      select: {
        id: true,
        recordingId: true,
        sessionId: true,
        status: true,
        source: true,
        language: true,
        text: true,
        segmentsJson: true,
        errorMessage: true,
        startedAt: true,
        completedAt: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    return NextResponse.json({ transcript: updated });
  } catch (error) {
    const errorMessage =
      error instanceof Error ? error.message : "转写失败。";

    const updated = await prisma.trainingTranscript.update({
      where: {
        recordingId,
      },
      data: {
        status: "FAILED",
        errorMessage,
      },
      select: {
        id: true,
        recordingId: true,
        sessionId: true,
        status: true,
        source: true,
        language: true,
        text: true,
        segmentsJson: true,
        errorMessage: true,
        startedAt: true,
        completedAt: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    return NextResponse.json(
      {
        error: errorMessage,
        transcript: updated,
      },
      { status: 500 },
    );
  }
}