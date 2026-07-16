import { randomUUID } from "crypto";
import { mkdir, rename, rm, writeFile } from "fs/promises";
import path from "path";
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { isSessionOwnedByCurrentUser } from "@/lib/auth-server";
import { readUploadIdempotencyKey } from "@/lib/upload-idempotency";
import {
  DEFAULT_TRANSCRIPTION_MAX_ATTEMPTS,
  TRAINING_TRANSCRIPTION_JOB_TYPE,
  trainingTranscriptionJobKey,
} from "@/lib/training-transcription-job.mjs";
import {
  streamWebBodyToFile,
  UploadStreamError,
} from "@/lib/stream-upload.mjs";

type RecordingRouteContext = Readonly<{
  params: Promise<{
    sessionId: string;
  }>;
}>;

const maxRecordingSizeBytes = 100 * 1024 * 1024;
const pitchUploadGraceAfterEndMs = 60_000;
const rawRecordingUploadVersion = "raw-v1";
const allowedAudioTypes = new Map([
  ["audio/webm", "webm"],
  ["audio/mp4", "m4a"],
  ["audio/mpeg", "mp3"],
  ["audio/wav", "wav"],
  ["audio/x-wav", "wav"],
]);

const recordingResponseSelect = {
  id: true,
  phase: true,
  status: true,
  fileName: true,
  mimeType: true,
  sizeBytes: true,
  durationSec: true,
  startedAt: true,
  endedAt: true,
  transcript: {
    select: {
      id: true,
      status: true,
      revision: true,
    },
  },
} as const;

function recordingUploadResponse(
  sessionId: string,
  recording: {
    id: string;
    phase: string;
    status: string;
    fileName: string;
    mimeType: string;
    sizeBytes: number;
    durationSec: number | null;
    startedAt: Date | null;
    endedAt: Date | null;
    transcript: { id: string; status: string; revision: number } | null;
  },
  idempotentReplay = false,
) {
  return NextResponse.json({
    recording: {
      ...recording,
      playbackUrl: `/training/${sessionId}/recordings/${recording.id}`,
    },
    idempotentReplay,
  });
}

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

function readRawOriginalName(value: string | null, fallback: string) {
  if (!value) return fallback;
  try {
    const decoded = decodeURIComponent(value).trim();
    return decoded ? decoded.slice(0, 255) : fallback;
  } catch {
    return fallback;
  }
}

function readExpectedContentLength(value: string | null) {
  if (!value) return null;
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : NaN;
}

function uploadStreamErrorResponse(error: UploadStreamError) {
  if (error.code === "TOO_LARGE") {
    return NextResponse.json(
      { error: "录音文件超过 100MB 上限。" },
      { status: 413 },
    );
  }
  if (error.code === "EMPTY") {
    return NextResponse.json({ error: "录音文件为空。" }, { status: 400 });
  }
  if (error.code === "SIZE_MISMATCH") {
    return NextResponse.json(
      { error: "录音上传不完整，请重新上传。" },
      { status: 400 },
    );
  }
  return NextResponse.json({ error: "录音上传失败。" }, { status: 400 });
}

function canUploadRecording(
  phase: "PITCH" | "QA",
  sessionStatus: string,
  pitchEndedAt: Date | null,
  requestReceivedAt: Date,
) {
  if (phase === "QA") {
    return sessionStatus === "QAING";
  }

  if (sessionStatus === "PITCHING") {
    return true;
  }

  // 当前前端会先结束路演，再立即上传刚停止的 Pitch 录音。
  return (
    sessionStatus === "QA_READY" &&
    pitchEndedAt !== null &&
    requestReceivedAt.getTime() - pitchEndedAt.getTime() >= 0 &&
    requestReceivedAt.getTime() - pitchEndedAt.getTime() <=
      pitchUploadGraceAfterEndMs
  );
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
  const requestReceivedAt = new Date();
  const { sessionId } = await context.params;
  if (!(await isSessionOwnedByCurrentUser(sessionId))) {
    return NextResponse.json({ error: "Session not found" }, { status: 404 });
  }
  const session = await prisma.trainingSession.findUnique({
    where: {
      id: sessionId,
    },
    select: {
      id: true,
      projectId: true,
      status: true,
      pitchEndedAt: true,
    },
  });

  if (!session) {
    return NextResponse.json({ error: "训练场次不存在。" }, { status: 404 });
  }

  let uploadKey: string;
  try {
    uploadKey = readUploadIdempotencyKey(request);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "上传幂等键无效。" },
      { status: 400 },
    );
  }

  const replay = await prisma.trainingRecording.findUnique({
    where: {
      sessionId_uploadKey: {
        sessionId,
        uploadKey,
      },
    },
    select: recordingResponseSelect,
  });
  if (replay) {
    return recordingUploadResponse(sessionId, replay, true);
  }

  const isRawUpload =
    request.headers.get("x-recording-upload") === rawRecordingUploadVersion;
  let legacyFile: File | null = null;
  let phase: "PITCH" | "QA";
  let mimeType: string;
  let originalName: string | null;
  let durationSec: number | null;
  let startedAt: Date | null;
  let endedAt: Date | null;
  let expectedBytes: number | null = null;

  if (isRawUpload) {
    phase = readRecordingPhase(request.headers.get("x-recording-phase"));
    mimeType = normalizeMimeType(request.headers.get("content-type") ?? "");
    originalName = readRawOriginalName(
      request.headers.get("x-recording-name"),
      `recording.${allowedAudioTypes.get(mimeType) ?? "webm"}`,
    );
    durationSec = readOptionalInteger(
      request.headers.get("x-recording-duration-sec"),
    );
    startedAt = readOptionalDate(request.headers.get("x-recording-started-at"));
    endedAt = readOptionalDate(request.headers.get("x-recording-ended-at"));
    expectedBytes = readExpectedContentLength(
      request.headers.get("content-length"),
    );

    if (Number.isNaN(expectedBytes)) {
      return NextResponse.json(
        { error: "录音文件大小声明无效。" },
        { status: 400 },
      );
    }
    if (expectedBytes === 0) {
      return NextResponse.json({ error: "录音文件为空。" }, { status: 400 });
    }
    if (expectedBytes !== null && expectedBytes > maxRecordingSizeBytes) {
      return NextResponse.json(
        { error: "录音文件超过 100MB 上限。" },
        { status: 413 },
      );
    }
  } else {
    let formData: FormData;
    try {
      formData = await request.formData();
    } catch {
      return NextResponse.json({ error: "录音上传格式无效。" }, { status: 400 });
    }
    const file = formData.get("file");
    if (!(file instanceof File)) {
      return NextResponse.json({ error: "缺少录音文件。" }, { status: 400 });
    }
    legacyFile = file;
    phase = readRecordingPhase(formData.get("phase"));
    mimeType = normalizeMimeType(file.type);
    originalName = file.name || null;
    durationSec = readOptionalInteger(formData.get("durationSec"));
    startedAt = readOptionalDate(formData.get("startedAt"));
    endedAt = readOptionalDate(formData.get("endedAt"));

    if (file.size <= 0) {
      return NextResponse.json({ error: "录音文件为空。" }, { status: 400 });
    }
    if (file.size > maxRecordingSizeBytes) {
      return NextResponse.json(
        { error: "录音文件超过 100MB 上限。" },
        { status: 413 },
      );
    }
  }

  if (
    !canUploadRecording(
      phase,
      session.status,
      session.pitchEndedAt,
      requestReceivedAt,
    )
  ) {
    return NextResponse.json(
      {
        error: "当前训练状态不能上传该阶段的录音。",
        reason: "invalid_recording_phase_for_session_status",
      },
      { status: 409 },
    );
  }

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
    const temporaryPath = `${absolutePath}.${randomUUID()}.tmp`;
    let sizeBytes: number;

    await mkdir(recordingDir, { recursive: true });
    try {
      if (isRawUpload) {
        const streamed = await streamWebBodyToFile(
          request.body,
          temporaryPath,
          {
            maxBytes: maxRecordingSizeBytes,
            expectedBytes,
            signal: request.signal,
          },
        );
        sizeBytes = streamed.receivedBytes;
      } else {
        const bytes = Buffer.from(await legacyFile!.arrayBuffer());
        await writeFile(temporaryPath, bytes, { flag: "wx" });
        sizeBytes = bytes.byteLength;
      }
      await rename(temporaryPath, absolutePath);
    } catch (error) {
      await rm(temporaryPath, { force: true }).catch(() => undefined);
      throw error;
    }

    let recording;
    try {
      recording = await prisma.$transaction(async (transaction) => {
        const created = await transaction.trainingRecording.create({
          data: {
            sessionId,
            projectId: session.projectId,
            phase,
            status: "RECORDED",
            originalName,
            fileName: safeFileName,
            filePath: storedPath,
            mimeType,
            sizeBytes,
            durationSec,
            startedAt,
            endedAt,
            uploadKey,
            transcript: {
              create: {
                sessionId,
                projectId: session.projectId,
                status: "PENDING",
                source: "ASR_PROVIDER",
                language: "zh-CN",
                text: "",
              },
            },
          },
          select: recordingResponseSelect,
        });
        await transaction.asyncJob.create({
          data: {
            jobKey: trainingTranscriptionJobKey(created.id),
            jobType: TRAINING_TRANSCRIPTION_JOB_TYPE,
            resourceId: created.id,
            status: "PENDING",
            ownerToken: "",
            attempt: 0,
            maxAttempts: DEFAULT_TRANSCRIPTION_MAX_ATTEMPTS,
          },
        });
        return created;
      });
    } catch (error) {
      await rm(absolutePath, { force: true }).catch(() => undefined);
      const concurrentReplay = await prisma.trainingRecording.findUnique({
        where: {
          sessionId_uploadKey: {
            sessionId,
            uploadKey,
          },
        },
        select: recordingResponseSelect,
      });
      if (concurrentReplay) {
        return recordingUploadResponse(sessionId, concurrentReplay, true);
      }
      throw error;
    }

    return recordingUploadResponse(sessionId, recording);
  } catch (error) {
    if (error instanceof UploadStreamError) {
      return uploadStreamErrorResponse(error);
    }
    return NextResponse.json({ error: "录音文件保存失败。" }, { status: 500 });
  }
}
