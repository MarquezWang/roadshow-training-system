import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdir, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

import { PrismaClient } from "@prisma/client";

const baseUrl =
  process.env.STABILITY_TEST_BASE_URL || "http://127.0.0.1:3210";

async function exists(target) {
  return Boolean(await stat(target).catch(() => null));
}

test("project, material and training deletion routes keep SQLite and uploads consistent", async (t) => {
  const prisma = new PrismaClient();
  const prefix = `delete-route-${Date.now()}-${randomUUID().slice(0, 8)}`;
  const userId = `${prefix}-user`;
  const createdProjectIds = [];
  const createdSessionIds = [];

  async function createProject(label) {
    const id = `${prefix}-${label}`;
    createdProjectIds.push(id);
    return prisma.project.create({
      data: {
        id,
        ownerId: userId,
        name: `Delete route ${label}`,
        field: "test",
        stage: "TRL 1",
        summary: "test",
        coreTechnology: "test",
        applicationScenario: "test",
        businessModel: "test",
        cooperationDemand: "test",
      },
    });
  }

  await prisma.user.create({
    data: {
      id: userId,
      name: "Deletion route user",
      email: `${prefix}@example.test`,
    },
  });

  try {
    await t.test("shared material paths are rejected without deleting either row or file", async () => {
      const project = await createProject("shared");
      const projectDirectory = path.join(
        process.cwd(),
        "uploads",
        "projects",
        project.id,
      );
      const source = path.join(projectDirectory, "shared.pdf");
      const storedPath = `uploads/projects/${project.id}/shared.pdf`;
      await mkdir(projectDirectory, { recursive: true });
      await writeFile(source, "%PDF-shared");
      const first = await prisma.fileAsset.create({
        data: {
          id: `${project.id}-file-a`,
          projectId: project.id,
          originalName: "shared-a.pdf",
          fileType: "pdf",
          filePath: storedPath,
          fileSize: 11,
        },
      });
      await prisma.fileAsset.create({
        data: {
          id: `${project.id}-file-b`,
          projectId: project.id,
          originalName: "shared-b.pdf",
          fileType: "pdf",
          filePath: storedPath,
          fileSize: 11,
        },
      });

      const response = await fetch(
        `${baseUrl}/projects/${project.id}/files/${first.id}/remove`,
        { method: "POST" },
      );
      assert.equal(response.status, 409);
      assert.equal(
        await prisma.fileAsset.count({ where: { projectId: project.id } }),
        2,
      );
      assert.equal(await exists(source), true);
    });

    await t.test("material deletion removes the database row, source and preview", async () => {
      const project = await createProject("material");
      const projectDirectory = path.join(
        process.cwd(),
        "uploads",
        "projects",
        project.id,
      );
      const source = path.join(projectDirectory, "source.pdf");
      const preview = path.join(projectDirectory, "preview.pdf");
      await mkdir(projectDirectory, { recursive: true });
      await Promise.all([
        writeFile(source, "%PDF-source"),
        writeFile(preview, "%PDF-preview"),
      ]);
      const file = await prisma.fileAsset.create({
        data: {
          id: `${project.id}-file`,
          projectId: project.id,
          originalName: "source.pptx",
          fileType: "pptx",
          filePath: `uploads/projects/${project.id}/source.pdf`,
          previewPdfPath: `uploads/projects/${project.id}/preview.pdf`,
          previewStatus: "READY",
          fileSize: 12,
        },
      });

      const response = await fetch(
        `${baseUrl}/projects/${project.id}/files/${file.id}/remove`,
        { method: "POST" },
      );
      assert.equal(response.status, 200);
      assert.equal(
        await prisma.fileAsset.findUnique({ where: { id: file.id } }),
        null,
      );
      assert.equal(await exists(source), false);
      assert.equal(await exists(preview), false);
    });

    await t.test("concurrent material deletion is idempotent and never returns a server error", async () => {
      const project = await createProject("concurrent");
      const projectDirectory = path.join(
        process.cwd(),
        "uploads",
        "projects",
        project.id,
      );
      const source = path.join(projectDirectory, "source.pdf");
      await mkdir(projectDirectory, { recursive: true });
      await writeFile(source, "%PDF-concurrent");
      const file = await prisma.fileAsset.create({
        data: {
          id: `${project.id}-file`,
          projectId: project.id,
          originalName: "source.pdf",
          fileType: "pdf",
          filePath: `uploads/projects/${project.id}/source.pdf`,
          fileSize: 15,
        },
      });
      const url = `${baseUrl}/projects/${project.id}/files/${file.id}/remove`;
      const responses = await Promise.all([
        fetch(url, { method: "POST" }),
        fetch(url, { method: "POST" }),
      ]);
      const statuses = responses.map((response) => response.status);

      assert.equal(statuses.includes(200), true);
      assert.equal(statuses.every((status) => status < 500), true);
      assert.equal(
        await prisma.fileAsset.findUnique({ where: { id: file.id } }),
        null,
      );
      assert.equal(await exists(source), false);
    });

    await t.test("training deletion removes recordings and their database graph", async () => {
      const project = await createProject("session");
      const sessionId = `${project.id}-session`;
      createdSessionIds.push(sessionId);
      const sessionDirectory = path.join(
        process.cwd(),
        "uploads",
        "training",
        sessionId,
      );
      const recordingPath = path.join(sessionDirectory, "pitch.webm");
      await mkdir(sessionDirectory, { recursive: true });
      await writeFile(recordingPath, "recording");
      await prisma.trainingSession.create({
        data: { id: sessionId, projectId: project.id },
      });
      await prisma.trainingRecording.create({
        data: {
          id: `${sessionId}-recording`,
          sessionId,
          projectId: project.id,
          fileName: "pitch.webm",
          filePath: `uploads/training/${sessionId}/pitch.webm`,
          mimeType: "audio/webm",
          sizeBytes: 9,
        },
      });

      const response = await fetch(
        `${baseUrl}/projects/${project.id}/training-sessions/${sessionId}`,
        { method: "DELETE" },
      );
      assert.equal(response.status, 200);
      assert.equal(
        await prisma.trainingSession.findUnique({ where: { id: sessionId } }),
        null,
      );
      assert.equal(await exists(sessionDirectory), false);
    });

    await t.test("project deletion removes project and session upload directories", async () => {
      const project = await createProject("project");
      const sessionId = `${project.id}-session`;
      createdSessionIds.push(sessionId);
      const projectDirectory = path.join(
        process.cwd(),
        "uploads",
        "projects",
        project.id,
      );
      const sessionDirectory = path.join(
        process.cwd(),
        "uploads",
        "training",
        sessionId,
      );
      await Promise.all([
        mkdir(projectDirectory, { recursive: true }),
        mkdir(sessionDirectory, { recursive: true }),
      ]);
      await Promise.all([
        writeFile(path.join(projectDirectory, "material.pdf"), "%PDF"),
        writeFile(path.join(sessionDirectory, "pitch.webm"), "recording"),
      ]);
      await prisma.trainingSession.create({
        data: { id: sessionId, projectId: project.id },
      });

      const response = await fetch(`${baseUrl}/projects/${project.id}/delete`, {
        method: "POST",
      });
      assert.equal(response.status, 200);
      assert.equal(
        await prisma.project.findUnique({ where: { id: project.id } }),
        null,
      );
      assert.equal(await exists(projectDirectory), false);
      assert.equal(await exists(sessionDirectory), false);
    });
  } finally {
    await prisma.project.deleteMany({
      where: { id: { in: createdProjectIds } },
    });
    await prisma.user.deleteMany({ where: { id: userId } });
    await Promise.all([
      ...createdProjectIds.map((projectId) =>
        rm(path.join(process.cwd(), "uploads", "projects", projectId), {
          recursive: true,
          force: true,
        }),
      ),
      ...createdSessionIds.map((sessionId) =>
        rm(path.join(process.cwd(), "uploads", "training", sessionId), {
          recursive: true,
          force: true,
        }),
      ),
    ]);
    await prisma.$disconnect();
  }
});
