import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";

import {
  acquireTrainingTranscriptionJob,
  completeTrainingTranscriptionJob,
  failTrainingTranscriptionJob,
  renewTrainingTranscriptionLease,
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

    async function createRecording(name, { withTranscript = true } = {}) {
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
          ...(withTranscript
            ? {
                transcript: {
                  create: {
                    sessionId,
                    projectId,
                    status: "PENDING",
                    source: "ASR_PROVIDER",
                    text: "",
                  },
                },
              }
            : {}),
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

      await t.test("不存在的录音返回 missing 且不创建任务", async () => {
        const recordingId = `${prefix}-missing`;
        const result = await acquireTrainingTranscriptionJob(prisma, {
          recordingId,
          sessionId,
          now: testTime(),
        });

        assert.deepEqual(result, {
          state: "missing",
          job: null,
          transcript: null,
        });
        assert.equal(
          await prisma.asyncJob.findUnique({
            where: { jobKey: trainingTranscriptionJobKey(recordingId) },
          }),
          null,
        );
      });

      await t.test("已有完成转写会短路并结清遗留任务", async () => {
        const recordingId = await createRecording("already-completed");
        const jobKey = trainingTranscriptionJobKey(recordingId);
        await prisma.trainingTranscript.update({
          where: { recordingId },
          data: {
            status: "COMPLETED",
            text: "已有可用文本",
            completedAt: testTime(-1_000),
          },
        });
        await prisma.asyncJob.update({
          where: { jobKey },
          data: {
            status: "RUNNING",
            ownerToken: "stale-owner",
            attempt: 1,
            leaseExpiresAt: testTime(60_000),
            errorMessage: "old error",
          },
        });

        const result = await acquireTrainingTranscriptionJob(prisma, {
          recordingId,
          sessionId,
          now: testTime(),
        });

        assert.equal(result.state, "completed");
        assert.equal(result.transcript.text, "已有可用文本");
        assert.equal(result.job.status, "COMPLETED");
        assert.equal(result.job.leaseExpiresAt, null);
        assert.equal(result.job.nextAttemptAt, null);
        assert.equal(result.job.errorMessage, null);
      });

      await t.test("未过期 RUNNING 任务保持现有 owner", async () => {
        const recordingId = await createRecording("active");
        const jobKey = trainingTranscriptionJobKey(recordingId);
        await prisma.asyncJob.update({
          where: { jobKey },
          data: {
            status: "RUNNING",
            ownerToken: "active-owner",
            attempt: 1,
            leaseExpiresAt: testTime(60_000),
          },
        });

        const result = await acquireTrainingTranscriptionJob(prisma, {
          recordingId,
          sessionId,
          now: testTime(),
        });

        assert.equal(result.state, "active");
        assert.equal(result.job.ownerToken, "active-owner");
        assert.equal(result.job.attempt, 1);
      });

      await t.test("领取前发现次数耗尽会同步失败任务和转写", async () => {
        const recordingId = await createRecording("attempt-limit");
        const jobKey = trainingTranscriptionJobKey(recordingId);
        await prisma.asyncJob.update({
          where: { jobKey },
          data: {
            status: "RETRY_WAIT",
            ownerToken: "previous-owner",
            attempt: 3,
            maxAttempts: 3,
            nextAttemptAt: testTime(-1),
          },
        });

        const result = await acquireTrainingTranscriptionJob(prisma, {
          recordingId,
          sessionId,
          now: testTime(),
        });

        assert.equal(result.state, "exhausted");
        assert.equal(result.job.status, "FAILED");
        assert.equal(result.transcript.status, "FAILED");
        assert.match(result.job.errorMessage, /重试次数已用尽/);
        assert.equal(result.transcript.errorMessage, result.job.errorMessage);
      });

      await t.test("只有当前 owner 能续租", async () => {
        const recordingId = await createRecording("renew");
        const jobKey = trainingTranscriptionJobKey(recordingId);
        const acquired = await acquireTrainingTranscriptionJob(prisma, {
          recordingId,
          sessionId,
          now: testTime(3 * 60 * 60_000),
        });
        assert.equal(acquired.state, "acquired");

        const renewedAt = testTime(3 * 60 * 60_000 + 1_000);
        assert.equal(
          await renewTrainingTranscriptionLease(prisma, {
            jobKey,
            ownerToken: acquired.ownerToken,
            now: renewedAt,
            leaseMs: 12_345,
          }),
          true,
        );
        assert.equal(
          await renewTrainingTranscriptionLease(prisma, {
            jobKey,
            ownerToken: "stale-owner",
            now: renewedAt,
          }),
          false,
        );
        assert.equal(
          (
            await prisma.asyncJob.findUniqueOrThrow({ where: { jobKey } })
          ).leaseExpiresAt.getTime(),
          renewedAt.getTime() + 12_345,
        );
      });

      await t.test("当前 owner 完成任务并写入 ASR 文本", async () => {
        const recordingId = await createRecording("complete");
        const jobKey = trainingTranscriptionJobKey(recordingId);
        const acquired = await acquireTrainingTranscriptionJob(prisma, {
          recordingId,
          sessionId,
          now: testTime(4 * 60 * 60_000),
        });
        assert.equal(acquired.state, "acquired");

        const completed = await completeTrainingTranscriptionJob(prisma, {
          jobKey,
          ownerToken: acquired.ownerToken,
          recordingId,
          revision: acquired.transcript.revision,
          text: "ASR 完成文本",
          segmentsJson: '[{"startMs":0,"endMs":1000}]',
          now: testTime(4 * 60 * 60_000 + 1_000),
        });

        assert.equal(completed.state, "completed");
        assert.equal(completed.transcript.status, "COMPLETED");
        assert.equal(completed.transcript.text, "ASR 完成文本");
        assert.equal(
          completed.transcript.segmentsJson,
          '[{"startMs":0,"endMs":1000}]',
        );
        assert.equal(
          (
            await prisma.asyncJob.findUniqueOrThrow({ where: { jobKey } })
          ).status,
          "COMPLETED",
        );
        assert.deepEqual(
          await completeTrainingTranscriptionJob(prisma, {
            jobKey,
            ownerToken: acquired.ownerToken,
            recordingId,
            revision: acquired.transcript.revision,
            text: "重复完成",
            now: testTime(4 * 60 * 60_000 + 2_000),
          }),
          { state: "owner-lost", transcript: null },
        );
      });

      await t.test("终止失败会截断错误且拒绝失效 owner", async () => {
        const recordingId = await createRecording("terminal-failure");
        const jobKey = trainingTranscriptionJobKey(recordingId);
        const acquired = await acquireTrainingTranscriptionJob(prisma, {
          recordingId,
          sessionId,
          now: testTime(5 * 60 * 60_000),
        });
        assert.equal(acquired.state, "acquired");

        const rejected = await failTrainingTranscriptionJob(prisma, {
          jobKey,
          ownerToken: "stale-owner",
          recordingId,
          revision: acquired.transcript.revision,
          retryable: false,
          errorMessage: "ignored",
          now: testTime(5 * 60 * 60_000 + 1_000),
        });
        assert.equal(rejected.state, "owner-lost");
        assert.equal(rejected.transcript, null);

        const failed = await failTrainingTranscriptionJob(prisma, {
          jobKey,
          ownerToken: acquired.ownerToken,
          recordingId,
          revision: acquired.transcript.revision,
          retryable: false,
          errorMessage: "x".repeat(600),
          now: testTime(5 * 60 * 60_000 + 2_000),
        });
        assert.equal(failed.state, "failed");
        assert.equal(failed.job.status, "FAILED");
        assert.equal(failed.job.errorMessage.length, 500);
        assert.equal(failed.transcript.status, "FAILED");
        assert.equal(failed.transcript.errorMessage.length, 500);
      });

      await t.test("领取时会创建缺失的转写记录", async () => {
        const recordingId = await createRecording("without-transcript", {
          withTranscript: false,
        });
        const acquired = await acquireTrainingTranscriptionJob(prisma, {
          recordingId,
          sessionId,
          now: testTime(6 * 60 * 60_000),
        });

        assert.equal(acquired.state, "acquired");
        assert.equal(acquired.transcript.recordingId, recordingId);
        assert.equal(acquired.transcript.status, "PROCESSING");
        assert.equal(acquired.transcript.source, "ASR_PROVIDER");
        assert.equal(acquired.transcript.revision, 1);
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
