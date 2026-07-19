import { randomUUID } from "node:crypto";
import { mkdir, open, rename, rm } from "node:fs/promises";
import path from "node:path";
import type { Prisma } from "@prisma/client";
import { runDocumentParserWorker } from "@/lib/document-parser-boundary.mjs";
import {
  validateInitialProjectMaterialMetadata,
  validateProjectFileSignature,
  type StoredProjectFile,
} from "@/lib/file-upload";
import { prisma } from "@/lib/prisma";
import { claimExpiredProjectMaterial } from "@/lib/project-material-cleanup.mjs";
import { streamWebBodyToFile } from "@/lib/stream-upload.mjs";

const DEFAULT_STAGING_LIFETIME_HOURS = 2;
const MATERIAL_TOKEN_PATTERN = /^[0-9a-f-]{36}$/i;

function stagingLifetimeMs() {
  const configured = Number(process.env.PROJECT_MATERIAL_RETENTION_HOURS);
  const hours =
    Number.isFinite(configured) && configured >= 0.25 && configured <= 24
      ? configured
      : DEFAULT_STAGING_LIFETIME_HOURS;
  return hours * 60 * 60_000;
}

function stagingRoot() {
  return path.resolve(
    /* turbopackIgnore: true */ process.cwd(),
    "uploads",
    "staged-project-materials",
  );
}

function assertInside(root: string, target: string) {
  const relative = path.relative(root, target);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error("材料文件路径不在允许目录中。");
  }
}

function ownerFilter(ownerId: string | null) {
  return ownerId ? { ownerId } : { ownerId: null };
}

export async function cleanupExpiredProjectMaterials(limit = 20) {
  const now = new Date();
  const staleReservationBefore = new Date(now.getTime() - 30 * 60_000);
  const expiredWhere: Prisma.PendingProjectMaterialWhereInput = {
    expiresAt: { lte: now },
    OR: [
      { consumedAt: null },
      { consumedAt: { lte: staleReservationBefore } },
    ],
  };
  const expired = await prisma.pendingProjectMaterial.findMany({
    where: expiredWhere,
    orderBy: { expiresAt: "asc" },
    take: limit,
    select: { id: true, filePath: true },
  });

  for (const item of expired) {
    const absolutePath = path.resolve(
      /* turbopackIgnore: true */ process.cwd(),
      item.filePath,
    );
    assertInside(stagingRoot(), absolutePath);

    const claimed = await claimExpiredProjectMaterial(prisma, {
      id: item.id,
      now,
      staleReservationBefore,
    });
    if (!claimed) continue;
    await rm(absolutePath, { force: true }).catch(() => undefined);
  }
}

async function readSignatureHeader(filePath: string) {
  const handle = await open(filePath, "r");
  const header = Buffer.alloc(8_192);

  try {
    const { bytesRead } = await handle.read(header, 0, header.length, 0);
    return header.subarray(0, bytesRead);
  } finally {
    await handle.close();
  }
}

export async function stageAndParseProjectMaterial(params: {
  body: ReadableStream<Uint8Array> | null;
  originalName: string;
  expectedBytes: number;
  ownerId: string | null;
  signal?: AbortSignal;
}) {
  validateInitialProjectMaterialMetadata({
    name: params.originalName,
    size: params.expectedBytes,
  });
  const token = randomUUID();
  const extension = path.extname(params.originalName).toLowerCase();
  const fileType = extension.slice(1);
  const relativePath = path
    .join("uploads", "staged-project-materials", `${token}${extension}`)
    .replaceAll(path.sep, "/");
  const absolutePath = path.resolve(
    /* turbopackIgnore: true */ process.cwd(),
    relativePath,
  );
  const temporaryPath = `${absolutePath}.${randomUUID()}.tmp`;

  assertInside(stagingRoot(), absolutePath);
  assertInside(stagingRoot(), temporaryPath);
  await mkdir(stagingRoot(), { recursive: true });

  try {
    await streamWebBodyToFile(params.body, temporaryPath, {
      maxBytes: params.expectedBytes,
      expectedBytes: params.expectedBytes,
      signal: params.signal,
    });
    const signatureHeader = await readSignatureHeader(temporaryPath);
    validateProjectFileSignature(params.originalName, signatureHeader);
    await rename(temporaryPath, absolutePath);
  } catch (error) {
    await rm(temporaryPath, { force: true }).catch(() => undefined);
    throw error;
  }

  let extractedText: string | null = null;
  let parseStatus = "SUCCESS";
  let parseError: string | null = null;

  try {
    extractedText = await runDocumentParserWorker({
      inputPath: absolutePath,
      fileType,
      signal: params.signal,
    });
  } catch (error) {
    parseStatus = "FAILED";
    parseError = error instanceof Error ? error.message : "文件解析失败。";
  }

  try {
    return await prisma.pendingProjectMaterial.create({
      data: {
        id: token,
        ownerId: params.ownerId,
        originalName: params.originalName,
        fileType,
        filePath: relativePath,
        fileSize: params.expectedBytes,
        extractedText,
        parseStatus,
        parseError,
        expiresAt: new Date(Date.now() + stagingLifetimeMs()),
      },
    });
  } catch (error) {
    await rm(absolutePath, { force: true }).catch(() => undefined);
    throw error;
  }
}

export async function findAvailableProjectMaterial(
  token: string,
  ownerId: string | null,
) {
  if (!MATERIAL_TOKEN_PATTERN.test(token)) return null;

  return prisma.pendingProjectMaterial.findFirst({
    where: {
      id: token,
      ...ownerFilter(ownerId),
      expiresAt: { gt: new Date() },
      consumedAt: null,
    },
  });
}

export async function reserveProjectMaterial(
  token: string,
  ownerId: string | null,
) {
  if (!MATERIAL_TOKEN_PATTERN.test(token)) {
    throw new Error("材料令牌无效，请重新上传材料。");
  }

  const now = new Date();
  const reserved = await prisma.pendingProjectMaterial.updateMany({
    where: {
      id: token,
      ...ownerFilter(ownerId),
      expiresAt: { gt: now },
      consumedAt: null,
    },
    data: { consumedAt: now },
  });
  if (reserved.count !== 1) {
    throw new Error("材料令牌已失效或已使用，请重新上传材料。");
  }

  return prisma.pendingProjectMaterial.findUniqueOrThrow({ where: { id: token } });
}

export async function finalizeProjectMaterial(
  projectId: string,
  material: Awaited<ReturnType<typeof reserveProjectMaterial>>,
): Promise<StoredProjectFile> {
  const sourcePath = path.resolve(
    /* turbopackIgnore: true */ process.cwd(),
    material.filePath,
  );
  assertInside(stagingRoot(), sourcePath);

  const projectDirectory = path.resolve(
    /* turbopackIgnore: true */ process.cwd(),
    "uploads",
    "projects",
    projectId.replace(/[^a-zA-Z0-9_-]/g, ""),
  );
  const storedName = `${randomUUID()}${path.extname(material.originalName).toLowerCase()}`;
  const targetPath = path.join(projectDirectory, storedName);
  await mkdir(projectDirectory, { recursive: true });
  await rename(sourcePath, targetPath);

  return {
    originalName: material.originalName,
    fileType: material.fileType,
    filePath: path
      .relative(/* turbopackIgnore: true */ process.cwd(), targetPath)
      .replaceAll(path.sep, "/"),
    fileSize: material.fileSize,
  };
}

export async function deleteProjectMaterialRecord(token: string) {
  await prisma.pendingProjectMaterial.deleteMany({ where: { id: token } });
}

export async function discardReservedProjectMaterial(
  token: string,
  stagedFilePath: string,
) {
  const absolutePath = path.resolve(
    /* turbopackIgnore: true */ process.cwd(),
    stagedFilePath,
  );
  assertInside(stagingRoot(), absolutePath);
  await Promise.allSettled([
    rm(absolutePath, { force: true }),
    prisma.pendingProjectMaterial.deleteMany({ where: { id: token } }),
  ]);
}
