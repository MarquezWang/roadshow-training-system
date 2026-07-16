import { NextRequest, NextResponse } from "next/server";
import { isSessionOwnedByCurrentUser } from "@/lib/auth-server";
import { prisma } from "@/lib/prisma";
import { trainingTranscriptionJobKey } from "@/lib/training-transcription-job.mjs";

type TranscriptRouteContext = Readonly<{
  params: Promise<{
    sessionId: string;
    recordingId: string;
  }>;
}>;

const allowedSources = new Set(["MANUAL", "MOCK"]);

function normalizeSource(value: unknown) {
  if (typeof value !== "string") {
    return "MANUAL";
  }

  const normalized = value.trim().toUpperCase();

  return allowedSources.has(normalized) ? normalized : "MANUAL";
}

function normalizeLanguage(value: unknown) {
  if (typeof value !== "string" || value.trim() === "") {
    return "zh-CN";
  }

  return value.trim().slice(0, 32);
}

async function findRecording(sessionId: string, recordingId: string) {
  return prisma.trainingRecording.findFirst({
    where: {
      id: recordingId,
      sessionId,
    },
    select: {
      id: true,
      sessionId: true,
      projectId: true,
    },
  });
}

export async function GET(
  _request: Request,
  context: TranscriptRouteContext,
) {
  const { sessionId, recordingId } = await context.params;
  if (!(await isSessionOwnedByCurrentUser(sessionId))) {
    return NextResponse.json({ error: "Session not found" }, { status: 404 });
  }

  const recording = await findRecording(sessionId, recordingId);

  if (!recording) {
    return NextResponse.json({ error: "录音不存在。" }, { status: 404 });
  }

  const transcript = await prisma.trainingTranscript.findUnique({
    where: {
      recordingId,
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
      revision: true,
    },
  });

  return NextResponse.json({ transcript });
}

export async function POST(
  request: NextRequest,
  context: TranscriptRouteContext,
) {
  const { sessionId, recordingId } = await context.params;
  if (!(await isSessionOwnedByCurrentUser(sessionId))) {
    return NextResponse.json({ error: "Session not found" }, { status: 404 });
  }

  const recording = await findRecording(sessionId, recordingId);

  if (!recording) {
    return NextResponse.json({ error: "录音不存在。" }, { status: 404 });
  }

  const body = (await request.json().catch(() => null)) as {
    text?: unknown;
    source?: unknown;
    language?: unknown;
  } | null;
  const text = typeof body?.text === "string" ? body.text.trim() : "";

  if (!text) {
    return NextResponse.json({ error: "转写文本不能为空。" }, { status: 400 });
  }

  const now = new Date();
  const source = normalizeSource(body?.source);
  const transcript = await prisma.$transaction(async (transaction) => {
    const saved = await transaction.trainingTranscript.upsert({
      where: {
        recordingId,
      },
      create: {
        recordingId,
        sessionId: recording.sessionId,
        projectId: recording.projectId,
        status: "COMPLETED",
        source,
        language: normalizeLanguage(body?.language),
        text,
        segmentsJson: null,
        completedAt: now,
        revision: 1,
      },
      update: {
        status: "COMPLETED",
        source,
        language: normalizeLanguage(body?.language),
        text,
        segmentsJson: null,
        errorMessage: null,
        completedAt: now,
        revision: { increment: 1 },
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
        revision: true,
      },
    });
    await transaction.asyncJob.updateMany({
      where: {
        jobKey: trainingTranscriptionJobKey(recordingId),
        status: { not: "COMPLETED" },
      },
      data: {
        status: "COMPLETED",
        leaseExpiresAt: null,
        nextAttemptAt: null,
        errorMessage: null,
      },
    });
    return saved;
  });

  return NextResponse.json({ transcript });
}
