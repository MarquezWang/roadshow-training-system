import { NextResponse } from "next/server";
import { isSessionOwnedByCurrentUser } from "@/lib/auth-server";
import {
  runTranscriptionWithLock,
  TranscribeHttpError,
} from "@/lib/training-transcribe-task";

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
  if (!(await isSessionOwnedByCurrentUser(sessionId))) {
    return NextResponse.json({ error: "Session not found" }, { status: 404 });
  }

  try {
    const result = await runTranscriptionWithLock(sessionId, recordingId);

    if (result.kind === "pending") {
      return NextResponse.json({
        ok: true,
        status: result.transcript.status,
        message: result.message,
        transcript: result.transcript,
      });
    }

    if (result.kind === "business-failed") {
      return NextResponse.json(
        {
          ok: false,
          status: "FAILED",
          businessFailure: true,
          message: result.message,
          transcript: result.transcript,
        },
        { status: 200 },
      );
    }

    if (result.kind === "system-failed") {
      return NextResponse.json(
        {
          error: result.message,
          transcript: result.transcript,
        },
        { status: 500 },
      );
    }

    return NextResponse.json({ transcript: result.transcript });
  } catch (error) {
    if (error instanceof TranscribeHttpError) {
      return NextResponse.json(
        { error: error.message },
        { status: error.status },
      );
    }

    return NextResponse.json(
      { error: "自动转写失败。" },
      { status: 500 },
    );
  }
}
