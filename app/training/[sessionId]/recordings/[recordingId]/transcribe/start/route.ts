import { NextResponse } from "next/server";
import { isSessionOwnedByCurrentUser } from "@/lib/auth-server";
import {
  startTranscriptionTask,
  TranscribeHttpError,
} from "@/lib/training-transcribe-task";

type StartTranscribeRouteContext = Readonly<{
  params: Promise<{
    sessionId: string;
    recordingId: string;
  }>;
}>;

export async function POST(
  _request: Request,
  context: StartTranscribeRouteContext,
) {
  const { sessionId, recordingId } = await context.params;
  if (!(await isSessionOwnedByCurrentUser(sessionId))) {
    return NextResponse.json({ error: "Session not found" }, { status: 404 });
  }

  try {
    const result = await startTranscriptionTask(sessionId, recordingId, {
      // 显式调用启动端点允许用户在最终失败后开启新一轮尝试。
      forceRetry: true,
    });

    return NextResponse.json({
      ok: result.transcript.status !== "FAILED",
      started: result.started,
      status: result.transcript.status,
      transcript: result.transcript,
    });
  } catch (error) {
    if (error instanceof TranscribeHttpError) {
      return NextResponse.json(
        { error: error.message },
        { status: error.status },
      );
    }

    return NextResponse.json(
      { error: "启动自动转写失败。" },
      { status: 500 },
    );
  }
}
