import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtemp, mkdir, rm, stat, utimes, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { PrismaClient } from "@prisma/client";

import {
  runUploadMaintenancePass,
  UPLOAD_MAINTENANCE_JOB_TYPE,
} from "../../lib/upload-maintenance-job.mjs";

async function exists(target) {
  return Boolean(await stat(target).catch(() => null));
}

test("upload maintenance uses a persistent lease, recovers stale jobs and reconciles missing files", async (t) => {
  const prisma = new PrismaClient();
  const prefix = `upload-maintenance-${Date.now()}-${randomUUID().slice(0, 8)}`;
  const workspaceRoot = await mkdtemp(
    path.join(os.tmpdir(), "upload-maintenance-test-"),
  );
  const jobKey = `${prefix}:job`;
  const busyJobKey = `${prefix}:busy`;
  const now = new Date(Date.now() + 60 * 60_000);

  await t.test("an active lease prevents a concurrent maintenance pass", async () => {
    await prisma.asyncJob.create({
      data: {
        jobKey: busyJobKey,
        jobType: UPLOAD_MAINTENANCE_JOB_TYPE,
        resourceId: "uploads",
        status: "RUNNING",
        ownerToken: "active-owner",
        leaseExpiresAt: new Date(now.getTime() + 60_000),
      },
    });
    const result = await runUploadMaintenancePass(prisma, {
      workspaceRoot,
      jobKey: busyJobKey,
      now,
      deleteStale: false,
    });
    assert.equal(result.state, "busy");
  });

  try {
    const projectRoot = path.join(
      workspaceRoot,
      "uploads",
      "projects",
      prefix,
    );
    await mkdir(projectRoot, { recursive: true });
    const orphanPath = path.join(projectRoot, "orphan.pdf");
    await writeFile(orphanPath, "orphan");
    const oldDate = new Date(now.getTime() - 48 * 60 * 60_000);
    await utimes(orphanPath, oldDate, oldDate);

    const user = await prisma.user.create({
      data: {
        id: `${prefix}-user`,
        name: "Upload maintenance user",
        email: `${prefix}@example.test`,
      },
    });
    const project = await prisma.project.create({
      data: {
        id: `${prefix}-project`,
        ownerId: user.id,
        name: "Upload maintenance project",
        field: "test",
        stage: "TRL 1",
        summary: "test",
        coreTechnology: "test",
        applicationScenario: "test",
        businessModel: "test",
        cooperationDemand: "test",
      },
    });
    const missingStoredPath = `uploads/projects/${prefix}/missing.pdf`;
    const file = await prisma.fileAsset.create({
      data: {
        id: `${prefix}-file`,
        projectId: project.id,
        originalName: "missing.pdf",
        fileType: "pdf",
        filePath: missingStoredPath,
        fileSize: 100,
        parseStatus: "SUCCESS",
      },
    });
    await prisma.asyncJob.create({
      data: {
        jobKey,
        jobType: UPLOAD_MAINTENANCE_JOB_TYPE,
        resourceId: "uploads",
        status: "RUNNING",
        ownerToken: "stale-owner",
        leaseExpiresAt: new Date(now.getTime() - 1_000),
      },
    });

    const result = await runUploadMaintenancePass(prisma, {
      workspaceRoot,
      jobKey,
      now,
      missingReferenceGraceMs: 1,
      orphanOlderThanMs: 1,
      temporaryOlderThanMs: 1,
      attemptOlderThanMs: 1,
      trashOlderThanMs: 1,
    });
    assert.equal(result.state, "completed");
    assert.ok(result.reconciled.missingSourceFiles >= 1);
    assert.equal(await exists(orphanPath), false);

    const [updatedFile, completedJob] = await Promise.all([
      prisma.fileAsset.findUnique({ where: { id: file.id } }),
      prisma.asyncJob.findUnique({ where: { jobKey } }),
    ]);
    assert.equal(updatedFile?.parseStatus, "FAILED");
    assert.match(updatedFile?.parseError ?? "", /源文件丢失/);
    assert.equal(completedJob?.status, "COMPLETED");
    assert.equal(completedJob?.attempt, 2);
  } finally {
    await prisma.asyncJob.deleteMany({
      where: { jobKey: { in: [jobKey, busyJobKey] } },
    });
    await prisma.project.deleteMany({ where: { id: `${prefix}-project` } });
    await prisma.user.deleteMany({ where: { id: `${prefix}-user` } });
    await prisma.$disconnect();
    await rm(workspaceRoot, { recursive: true, force: true });
  }
});
