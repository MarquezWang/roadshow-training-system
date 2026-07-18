import "server-only";

import { execFile } from "child_process";
import { access, mkdir, rm, writeFile } from "fs/promises";
import path from "path";
import { promisify } from "util";
import {
  readRecentDiagnosticEvents,
  type DiagnosticEvent,
} from "@/lib/diagnostic-log";
import { checkLibreOfficeAvailability } from "@/lib/powerpoint-preview";
import type { LibreOfficeCheckResult } from "@/lib/powerpoint-preview/types";
import { prisma } from "@/lib/prisma";
import {
  getTranscriptionProvider,
  type TranscriptionProvider,
} from "@/lib/transcription";
import {
  getSystemConfigurationStatus,
  type SystemConfigurationStatus,
} from "./system-status-policy";

const execFileAsync = promisify(execFile);

export type SystemCheckResult =
  | { ok: true; value: string; note?: never }
  | { ok: false; value: string; note: string };

export type RuntimeVersion = {
  branch: string;
  commit: string;
};

export type SystemStatusData = {
  libreOffice: LibreOfficeCheckResult;
  databaseCheck: SystemCheckResult;
  uploadDirectoryCheck: SystemCheckResult;
  diagnosticEvents: DiagnosticEvent[];
  runtimeVersion: RuntimeVersion;
  configuration: SystemConfigurationStatus;
};

async function checkDatabaseConnection(): Promise<SystemCheckResult> {
  try {
    await prisma.$queryRaw`SELECT 1`;
    return { ok: true, value: "可连接" };
  } catch (error) {
    return {
      ok: false,
      value: "连接失败",
      note: error instanceof Error ? error.message : "未知错误",
    };
  }
}

async function checkUploadDirectory(): Promise<SystemCheckResult> {
  const uploadsDir = path.join(process.cwd(), "uploads");
  const testFile = path.join(uploadsDir, `.write-test-${Date.now()}.tmp`);

  try {
    await mkdir(uploadsDir, { recursive: true });
    await writeFile(testFile, "ok");
    await access(testFile);
    await rm(testFile, { force: true });

    return { ok: true, value: "可写" };
  } catch (error) {
    await rm(testFile, { force: true }).catch(() => undefined);

    return {
      ok: false,
      value: "不可写",
      note: error instanceof Error ? error.message : "未知错误",
    };
  }
}

async function readGitValue(args: string[]) {
  try {
    const { stdout } = await execFileAsync("git", args, {
      cwd: process.cwd(),
      timeout: 1500,
    });

    return stdout.trim() || "未知";
  } catch {
    return "不可用";
  }
}

async function readRuntimeVersion(): Promise<RuntimeVersion> {
  const [branch, commit] = await Promise.all([
    readGitValue(["rev-parse", "--abbrev-ref", "HEAD"]),
    readGitValue(["rev-parse", "--short", "HEAD"]),
  ]);

  return { branch, commit };
}

export async function loadSystemStatusData(): Promise<SystemStatusData> {
  const [
    libreOffice,
    databaseCheck,
    uploadDirectoryCheck,
    diagnosticEvents,
    runtimeVersion,
  ] = await Promise.all([
    checkLibreOfficeAvailability(),
    checkDatabaseConnection(),
    checkUploadDirectory(),
    readRecentDiagnosticEvents(12),
    readRuntimeVersion(),
  ]);
  const transcriptionProvider: TranscriptionProvider =
    getTranscriptionProvider();
  const configuration = getSystemConfigurationStatus({
    env: process.env,
    transcriptionProvider,
  });

  return {
    libreOffice,
    databaseCheck,
    uploadDirectoryCheck,
    diagnosticEvents,
    runtimeVersion,
    configuration,
  };
}
