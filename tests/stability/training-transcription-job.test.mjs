import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";

import {
  acquireTrainingTranscriptionJob,
  completeTrainingTranscriptionJob,
  failTrainingTranscriptionJob,
  trainingTranscriptionJobKey,
} from "../../lib/training-transcription-job.mjs";

const databaseUrl = process.env.STABILITY_TEST_DATABASE_URL?.trim() ?? "";

function safetySkipReason() {
  const normalized = databaseUrl.toLowerCase();
  if (!normalized.startsWith("file:")) return "需要专用 SQLite 测试数据库。";
  if (!normalized.includes("test") && !normalized.includes("stability")) {
    return "测试数据库名称必须包含 test 或 stability。";
  }
  return null;
}

test(
  "ASR 任务持久化租约、退避、重试上限和 manual-wins",
  { skip: safetySkipReason() || false },
  async (t) => {
    const { PrismaClient } = await import("@prisma/client");
    const prisma = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
    const prefix = `transcription-job-${Date.now()}-${randomUUID().slice(0, 8)}`;
    const userId = `${prefix}-user`;
    const projectId = `${prefix}-project`;
    const sessionId = `${prefix}-session`;
    const recordingIds = [];
    const simulatedClockStart = Date.now() + 24 * 60 * 60_000;
    const testTime = (offsetMs = 0) =>
      new Date(simulatedClockStart + offsetMs);

    async function createRecording(name) {
      const recordingId = `${prefix}-${name}`;
      recordingIds.push(recordingId);
      await prisma.trainingRecording.create({
        data: {
          id: recordingId,
          sessionId,
          projectId,
          phase: "QA",
          fileName: `${name}.webm`,
          filePath: `uploads/${name}.webm`,
          mimeType: "audio/webm",
          sizeBytes: 1,
          transcript: {
            create: {
              sessionId,
              projectId,
              status: "PENDING",
              source: "ASR_PROVIDER",
              text: "",
            },
          },
        },
      });
      await prisma.asyncJob.create({
        data: {
          jobKey: trainingTranscriptionJobKey(recordingId),
          jobType: "TRAINING_TRANSCRIPTION",
          resourceId: recordingId,
          // The dev server recovery worker shares this test database. Keep the
          // fixture in future backoff so only explicit simulated-time calls
          // can acquire it.
          status: "RETRY_WAIT",
          ownerToken: "",
          attempt: 0,
          maxAttempts: 3,
          nextAttemptAt: testTime(-1),
        },
      });
      return recordingId;
    }

    try {
      await prisma.user.create({
        data: { id: userId, email: `${prefix}@example.test`, name: prefix },
      });
      await prisma.project.create({
        data: {
          id: projectId,
          ownerId: userId,
          name: prefix,
          field: "TEST",
          stage: "TEST",
          summary: "fixture",
          coreTechnology: "fixture",
          applicationScenario: "fixture",
          businessModel: "fixture",
          cooperationDemand: "fixture",
        },
      });
      await prisma.trainingSession.create({
        data: { id: sessionId, projectId, status: "QA_ENDED" },
      });

      await t.test("并发领取只有一个 owner", async () => {
        const recordingId = await createRecording("concurrent");
        const now = testTime();
        const results = await Promise.all([
          acquireTrainingTranscriptionJob(prisma, { recordingId, sessionId, now }),
          acquireTrainingTranscriptionJob(prisma, { recordingId, sessionId, now }),
        ]);
        assert.equal(results.filter((result) => result.state === "acquired").length, 1);
        assert.equal(
          (await prisma.asyncJob.findUniqueOrThrow({
            where: { jobKey: trainingTranscriptionJobKey(recordingId) },
          })).attempt,
          1,
        );
      });

      await t.test("过期 RUNNING 任务可被新 owner 接管", async () => {
        const recordingId = await createRecording("expired");
        const jobKey = trainingTranscriptionJobKey(recordingId);
        await prisma.asyncJob.update({
          where: { jobKey },
          data: {
            status: "RUNNING",
            ownerToken: "stale-owner",
            attempt: 1,
            leaseExpiresAt: testTime(-60_000),
          },
        });
        const acquired = await acquireTrainingTranscriptionJob(prisma, {
          recordingId,
          sessionId,
          now: testTime(),
        });
        assert.equal(acquired.state, "acquired");
        assert.notEqual(acquired.ownerToken, "stale-owner");
        assert.equal(acquired.job.attempt, 2);
      });

      await t.test("可重试失败持久化退避，到上限后停止", async () => {
        const recordingId = await createRecording("backoff");
        const jobKey = trainingTranscriptionJobKey(recordingId);
        const startedAt = testTime(60 * 60_000);
        const first = await acquireTrainingTranscriptionJob(prisma, {
          recordingId,
          sessionId,
          now: startedAt,
        });
        assert.equal(first.state, "acquired");
        const failedFirst = await failTrainingTranscriptionJob(prisma, {
          jobKey,
          ownerToken: first.ownerToken,
          recordingId,
          revision: first.transcript.revision,
          retryable: true,
          retryDelayMs: 60_000,
          errorMessage: "temporary",
          now: testTime(60 * 60_000 + 1_000),
        });
        assert.equal(failedFirst.state, "retry-scheduled");
        assert.equal(
          (await acquireTrainingTranscriptionJob(prisma, {
            recordingId,
            sessionId,
            now: testTime(60 * 60_000 + 30_000),
          })).state,
          "backoff",
        );
        const second = await acquireTrainingTranscriptionJob(prisma, {
          recordingId,
          sessionId,
          now: testTime(61 * 60_000 + 2_000),
        });
        assert.equal(second.state, "acquired");
        await failTrainingTranscriptionJob(prisma, {
          jobKey,
          ownerToken: second.ownerToken,
          recordingId,
          revision: second.transcript.revision,
          retryable: true,
          retryDelayMs: 1,
          errorMessage: "temporary 2",
          now: testTime(61 * 60_000 + 3_000),
        });
        const third = await acquireTrainingTranscriptionJob(prisma, {
          recordingId,
          sessionId,
          now: testTime(61 * 60_000 + 4_000),
        });
        assert.equal(third.state, "acquired");
        const finalFailure = await failTrainingTranscriptionJob(prisma, {
          jobKey,
          ownerToken: third.ownerToken,
          recordingId,
          revision: third.transcript.revision,
          retryable: true,
          retryDelayMs: 1,
          errorMessage: "temporary 3",
          now: testTime(61 * 60_000 + 5_000),
        });
        assert.equal(finalFailure.state, "failed");
        assert.equal(
          (await acquireTrainingTranscriptionJob(prisma, {
            recordingId,
            sessionId,
            now: testTime(61 * 60_000 + 6_000),
          })).state,
          "exhausted",
        );
        const manualRetry = await acquireTrainingTranscriptionJob(prisma, {
          recordingId,
          sessionId,
          forceRetry: true,
          now: testTime(61 * 60_000 + 7_000),
        });
        // forceRetry 会先将 FAILED 重置为 PENDING；共享测试库中的另一个
        // 合法领取者可能在本调用的 CAS 前获胜，此时 active 同样表示重试已启动。
        assert.ok(
          manualRetry.state === "acquired" || manualRetry.state === "active",
        );
        assert.equal(manualRetry.job.attempt, 1);
      });

      await t.test("手工修订后迟到 ASR 不能覆盖", async () => {
        const recordingId = await createRecording("manual-wins");
        const acquired = await acquireTrainingTranscriptionJob(prisma, {
          recordingId,
          sessionId,
          now: testTime(2 * 60 * 60_000),
        });
        assert.equal(acquired.state, "acquired");
        await prisma.trainingTranscript.update({
          where: { recordingId },
          data: {
            status: "COMPLETED",
            source: "MANUAL",
            text: "用户确认的文本",
            revision: { increment: 1 },
          },
        });
        const completed = await completeTrainingTranscriptionJob(prisma, {
          jobKey: trainingTranscriptionJobKey(recordingId),
          ownerToken: acquired.ownerToken,
          recordingId,
          revision: acquired.transcript.revision,
          text: "迟到的 ASR 文本",
          now: testTime(2 * 60 * 60_000 + 1_000),
        });
        assert.equal(completed.state, "superseded");
        assert.equal(completed.transcript.text, "用户确认的文本");
        assert.equal(completed.transcript.source, "MANUAL");
      });
    } finally {
      await prisma.asyncJob.deleteMany({
        where: { resourceId: { in: recordingIds } },
      });
      await prisma.trainingRecording.deleteMany({
        where: { id: { in: recordingIds } },
      });
      await prisma.trainingSession.deleteMany({ where: { id: sessionId } });
      await prisma.project.deleteMany({ where: { id: projectId } });
      await prisma.user.deleteMany({ where: { id: userId } });
      await prisma.$disconnect();
    }
  },
);
