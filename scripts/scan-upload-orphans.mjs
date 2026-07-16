#!/usr/bin/env node

import { pathToFileURL } from "node:url";
import path from "node:path";

import {
  DEFAULT_UPLOAD_RETENTION_MS,
  scanUploadTree,
} from "../lib/upload-orphan-scan.mjs";

export { scanUploadTree };

function readOlderThanMs(argv) {
  const argument = argv.find((value) => value.startsWith("--older-than-hours="));
  if (!argument) return DEFAULT_UPLOAD_RETENTION_MS;
  const hours = Number(argument.slice("--older-than-hours=".length));
  if (!Number.isFinite(hours) || hours <= 0) {
    throw new Error("--older-than-hours 必须是大于 0 的数字。");
  }
  return hours * 3_600_000;
}

async function main() {
  const deleteStale = process.argv.includes("--delete-stale");
  const unknownDestructiveFlag = process.argv.find(
    (value) => value.startsWith("--delete") && value !== "--delete-stale",
  );
  if (unknownDestructiveFlag) {
    throw new Error(`不支持的删除参数：${unknownDestructiveFlag}`);
  }

  const { PrismaClient } = await import("@prisma/client");
  const prisma = new PrismaClient();
  try {
    const [files, recordings] = await Promise.all([
      prisma.fileAsset.findMany({
        select: { filePath: true, previewPdfPath: true },
      }),
      prisma.trainingRecording.findMany({ select: { filePath: true } }),
    ]);
    const references = [
      ...files.flatMap((file) => [file.filePath, file.previewPdfPath]),
      ...recordings.map((recording) => recording.filePath),
    ];
    const report = await scanUploadTree({
      workspaceRoot: process.cwd(),
      references,
      olderThanMs: readOlderThanMs(process.argv.slice(2)),
      deleteStale,
    });
    console.log(JSON.stringify(report, null, 2));
  } finally {
    await prisma.$disconnect();
  }
}

const invokedPath = process.argv[1]
  ? pathToFileURL(path.resolve(process.argv[1])).href
  : "";
if (invokedPath === import.meta.url) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
