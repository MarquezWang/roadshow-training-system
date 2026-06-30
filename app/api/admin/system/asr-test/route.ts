import { randomUUID } from "crypto";
import { mkdir, rm, writeFile } from "fs/promises";
import { NextResponse } from "next/server";
import path from "path";
import { getCurrentAuthUser } from "@/lib/auth-server";
import { writeDiagnosticEvent } from "@/lib/diagnostic-log";
import { getTranscriptionProvider, transcribeAudio } from "@/lib/transcription";

export const runtime = "nodejs";

const MAX_TEST_AUDIO_BYTES = 10 * 1024 * 1024;

function getSafeExtension(fileName: string) {
  const extension = path.extname(fileName).toLowerCase();

  if (!extension || extension.length > 12 || !/^\.[a-z0-9]+$/.test(extension)) {
    return ".webm";
  }

  return extension;
}

export async function POST(request: Request) {
  const user = await getCurrentAuthUser();

  if (!user || user.role !== "ADMIN") {
    return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
  }

  const startedAt = Date.now();
  let provider = "unknown";
  let tempPath: string | null = null;

  try {
    provider = getTranscriptionProvider();
    const formData = await request.formData();
    const file = formData.get("audio");

    if (!(file instanceof File)) {
      return NextResponse.json(
        { error: "请上传一段测试音频。" },
        { status: 400 },
      );
    }

    if (file.size <= 0 || file.size > MAX_TEST_AUDIO_BYTES) {
      return NextResponse.json(
        { error: "测试音频大小需在 10MB 以内。" },
        { status: 400 },
      );
    }

    const tempDir = path.join(process.cwd(), "uploads", "admin-asr-tests");
    await mkdir(tempDir, { recursive: true });
    tempPath = path.join(
      tempDir,
      `${Date.now()}-${randomUUID()}${getSafeExtension(file.name)}`,
    );
    const buffer = Buffer.from(await file.arrayBuffer());
    await writeFile(tempPath, buffer);

    const result = await transcribeAudio(tempPath, file.type);
    const elapsedMs = Date.now() - startedAt;

    await writeDiagnosticEvent({
      type: "SYSTEM_TEST",
      message: "ASR test succeeded",
      meta: {
        provider,
        elapsedMs,
        textLength: result.text.trim().length,
      },
    });

    return NextResponse.json({
      provider,
      elapsedMs,
      text: result.text,
      segments: result.segments.length,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "ASR 测试失败。";
    await writeDiagnosticEvent({
      type: "SYSTEM_TEST",
      message: `ASR test failed: ${message}`,
      meta: {
        provider,
        elapsedMs: Date.now() - startedAt,
      },
    });

    return NextResponse.json(
      {
        error: "ASR 测试失败，请检查当前转写配置或服务商状态。",
        detail: message.slice(0, 200),
      },
      { status: 500 },
    );
  } finally {
    if (tempPath) {
      await rm(tempPath, { force: true }).catch(() => undefined);
    }
  }
}
