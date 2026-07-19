import assert from "node:assert/strict";
import { after, test } from "node:test";

import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

after(async () => {
  await prisma.$disconnect();
});

async function tableSql(tableName) {
  const rows = await prisma.$queryRawUnsafe(
    "SELECT sql FROM sqlite_master WHERE type = 'table' AND name = ?",
    tableName,
  );
  assert.equal(rows.length, 1, `${tableName} must exist`);
  return rows[0].sql;
}

test("workflow tables expose database CHECK constraints", async () => {
  const expectedColumns = new Map([
    ["User", ["role"]],
    ["PendingProjectMaterial", ["parseStatus"]],
    ["AsyncJob", ["status"]],
    ["WorkerHeartbeat", ["workerType"]],
    ["FileAsset", ["parseStatus", "previewStatus"]],
    ["TrainingSession", ["status"]],
    ["SlideEvent", ["eventType"]],
    ["TrainingRecording", ["phase", "status"]],
    ["TrainingTranscript", ["status", "source"]],
    ["TrainingAnalysis", ["status", "analysisType"]],
    ["TrainingQuestion", ["source"]],
    ["KnowledgeSource", ["status"]],
  ]);

  for (const [tableName, columns] of expectedColumns) {
    const sql = await tableSql(tableName);
    for (const column of columns) {
      assert.match(
        sql,
        new RegExp(`CHECK \\(\\"${column}\\" IN \\(`),
        `${tableName}.${column} must be constrained by the database`,
      );
    }
  }
});

test("database rejects an invalid user role", async () => {
  const suffix = `${process.pid}-${Date.now()}`;

  await assert.rejects(
    prisma.$executeRawUnsafe(
      `INSERT INTO "User"
        ("id", "name", "email", "role", "updatedAt")
       VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)`,
      `invalid-role-${suffix}`,
      "Invalid role probe",
      `invalid-role-${suffix}@example.test`,
      "SUPERADMIN",
    ),
    /CHECK constraint failed/i,
  );
});

test("database rejects an invalid async job state", async () => {
  const suffix = `${process.pid}-${Date.now()}`;

  await assert.rejects(
    prisma.$executeRawUnsafe(
      `INSERT INTO "AsyncJob"
        ("id", "jobKey", "jobType", "resourceId", "status", "ownerToken", "updatedAt")
       VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)`,
      `invalid-job-${suffix}`,
      `invalid-job-key-${suffix}`,
      "TEST",
      `resource-${suffix}`,
      "PAUSED_FOREVER",
      "probe",
    ),
    /CHECK constraint failed/i,
  );
});
