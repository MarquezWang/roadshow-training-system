import { NextResponse } from "next/server";
import { isSessionOwnedByCurrentUser } from "@/lib/auth-server";
import {
  getRunningTranscriptionTask,
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
    const runningTask = getRunningTranscriptionTask(recordingId);

    if (runningTask) {
      const result = await Promise.race([
        runningTask,
        new Promise<null>((resolve) => setTimeout(() => resolve(null), 50)),
      ]);

      if (result) {
        return NextResponse.json({
          ok: result.kind === "completed",
          started: false,
          status: result.transcript.status,
          transcript: result.transcript,
        });
      }
    }

    const result = await startTranscriptionTask(sessionId, recordingId);

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
