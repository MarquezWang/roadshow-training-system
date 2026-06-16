import { existsSync } from "fs";
import path from "path";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { transcribeAudio } from "@/lib/transcription";
import { TranscribeBusinessError } from "@/lib/transcribe-error";
import { devError, devLog, devWarn } from "@/lib/dev-log";

type TranscribeRouteContext = Readonly<{
  params: Promise<{
    sessionId: string;
    recordingId: string;
  }>;
}>;

const MAX_TRANSCRIBE_ATTEMPTS = 3;
const TRANSCRIBE_RETRY_DELAYS_MS = [1_500, 3_000] as const;
const TEMPORARY_TRANSCRIBE_ERROR_MESSAGE =
  "转写服务暂时不可用，请稍后重试。";

const transcriptSelect = {
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
} as const;

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function getErrorSummary(error: unknown) {
  const message =
    error instanceof TranscribeBusinessError
      ? error.rawMessage || error.userMessage
      : error instanceof Error
        ? error.message
        : String(error);

  return message
    .replace(/sk-[A-Za-z0-9_-]+/g, "[redacted]")
    .replace(/Bearer\s+[A-Za-z0-9._-]+/g, "Bearer [redacted]")
    .slice(0, 500);
}

function isRetryableTranscribeError(error: unknown) {
  const summary = getErrorSummary(error).toLowerCase();
  const isBusinessError = error instanceof TranscribeBusinessError;

  const nonRetryableIndicators = [
    "api key",
    "unsupported",
    "not supported",
    "ffmpeg",
    "file does not exist",
    "audio file does not exist",
  ];

  if (nonRetryableIndicators.some((indicator) => summary.includes(indicator))) {
    return false;
  }

  const retryableIndicators = [
    "fetch failed",
    "network",
    "timeout",
    "timed out",
    "econnreset",
    "etimedout",
    "socket hang up",
    "temporarily unavailable",
    "service unavailable",
    "bad gateway",
    "gateway timeout",
    "internal server error",
    "http 500",
    "http 502",
    "http 503",
    "http 504",
    "5xx",
    "empty",
    "为空",
    "涓虹┖",
    "orderresult",
  ];

  if (isBusinessError) {
    return retryableIndicators.some((indicator) =>
      summary.includes(indicator),
    );
  }

  return retryableIndicators.some((indicator) => summary.includes(indicator));
}

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
        select: transcriptSelect,
      },
    },
  });

  if (!recording) {
    return NextResponse.json({ error: "录音不存在。" }, { status: 404 });
  }

  if (recording.phase !== "PITCH" && recording.phase !== "QA") {
    return NextResponse.json(
      { error: "仅支持转写 PITCH 或 QA 阶段录音。" },
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

  if (
    recording.transcript?.status === "COMPLETED" &&
    recording.transcript.text.trim()
  ) {
    devLog("[transcribe:POST] completed transcript exists", {
      sessionId,
      recordingId,
      transcriptId: recording.transcript.id,
    });

    return NextResponse.json({ transcript: recording.transcript });
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
    let finalError: unknown = null;

    for (
      let attemptIndex = 1;
      attemptIndex <= MAX_TRANSCRIBE_ATTEMPTS;
      attemptIndex++
    ) {
      devLog("[transcribe:POST] ASR attempt started", {
        sessionId,
        recordingId,
        attemptIndex,
        maxAttempts: MAX_TRANSCRIBE_ATTEMPTS,
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
          select: transcriptSelect,
        });

        devLog("[transcribe:POST] ASR attempt succeeded", {
          sessionId,
          recordingId,
          attemptIndex,
          maxAttempts: MAX_TRANSCRIBE_ATTEMPTS,
        });

        return NextResponse.json({ transcript: updated });
      } catch (error) {
        finalError = error;
        const retryable = isRetryableTranscribeError(error);
        const errorSummary = getErrorSummary(error);

        devWarn("[transcribe:POST] ASR attempt failed", {
          sessionId,
          recordingId,
          attemptIndex,
          maxAttempts: MAX_TRANSCRIBE_ATTEMPTS,
          retryable,
          errorSummary,
        });

        if (!retryable || attemptIndex >= MAX_TRANSCRIBE_ATTEMPTS) {
          break;
        }

        await sleep(TRANSCRIBE_RETRY_DELAYS_MS[attemptIndex - 1] ?? 3_000);
      }
    }

    throw finalError ?? new Error(TEMPORARY_TRANSCRIBE_ERROR_MESSAGE);
  } catch (error) {
    const now = new Date();
    const errorSummary = getErrorSummary(error);

    devError("[transcribe:POST] ASR final failure", {
      sessionId,
      recordingId,
      errorSummary,
    });

    if (error instanceof TranscribeBusinessError) {
      // 业务失败：写入用户友好 errorMessage，返回 200
      const updated = await prisma.trainingTranscript.update({
        where: {
          recordingId,
        },
        data: {
          status: "FAILED",
          errorMessage: error.userMessage,
          completedAt: now,
        },
        select: transcriptSelect,
      });

      return NextResponse.json(
        {
          ok: false,
          status: "FAILED",
          businessFailure: true,
          message: error.userMessage,
          transcript: updated,
        },
        { status: 200 },
      );
    }

    // 系统错误：返回 500
    const errorMessage = isRetryableTranscribeError(error)
      ? TEMPORARY_TRANSCRIBE_ERROR_MESSAGE
      : errorSummary;

    const updated = await prisma.trainingTranscript.update({
      where: {
        recordingId,
      },
      data: {
        status: "FAILED",
        errorMessage,
        completedAt: now,
      },
      select: transcriptSelect,
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
