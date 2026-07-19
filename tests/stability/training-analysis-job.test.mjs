import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";

import {
  acquireTrainingAnalysisJob,
  completeTrainingAnalysisJob,
  deferTrainingAnalysisJob,
  failTrainingAnalysisJob,
  parseTrainingAnalysisJobPayload,
  queueTrainingAnalysisJob,
  TRAINING_ANALYSIS_JOB_PAYLOAD_SCHEMA_VERSION,
  TRAINING_ANALYSIS_JOB_TYPE,
  trainingAnalysisJobKey,
} from "../../lib/training-analysis-job.mjs";

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
  "报告任务持久化参数、并发领取、退避重试与完成状态",
  { skip: safetySkipReason() || false },
  async (t) => {
    const { PrismaClient } = await import("@prisma/client");
    const prisma = new PrismaClient({
      datasources: { db: { url: databaseUrl } },
    });
    const prefix = `analysis-job-${Date.now()}-${randomUUID().slice(0, 8)}`;
    const sessionIds = [];
    const base = new Date(Date.now() + 24 * 60 * 60_000);

    try {
      await t.test("不存在的任务不会被领取", async () => {
        const result = await acquireTrainingAnalysisJob(prisma, {
          sessionId: `${prefix}-missing`,
          now: base,
        });
        assert.equal(result.state, "missing");
        assert.equal(result.job, null);
      });

      await t.test("入队幂等且并发领取只有一个 owner", async () => {
        const sessionId = `${prefix}-lifecycle`;
        sessionIds.push(sessionId);
        const first = await queueTrainingAnalysisJob(prisma, { sessionId });
        const second = await queueTrainingAnalysisJob(prisma, { sessionId });

        assert.equal(first.state, "queued");
        assert.equal(first.job.status, "PENDING");
        assert.equal(first.job.attempt, 0);
        assert.equal(second.job.id, first.job.id);
        assert.equal(
          first.job.payloadSchemaVersion,
          TRAINING_ANALYSIS_JOB_PAYLOAD_SCHEMA_VERSION,
        );
        assert.deepEqual(parseTrainingAnalysisJobPayload(first.job), {
          forceRegeneration: false,
        });
        assert.equal(
          await prisma.asyncJob.count({
            where: { jobKey: trainingAnalysisJobKey(sessionId) },
          }),
          1,
        );

        const claims = await Promise.all([
          acquireTrainingAnalysisJob(prisma, { sessionId, now: base }),
          acquireTrainingAnalysisJob(prisma, { sessionId, now: base }),
        ]);
        const acquired = claims.find((claim) => claim.state === "acquired");
        assert.ok(acquired?.ownerToken);
        assert.equal(
          claims.filter((claim) => claim.state === "acquired").length,
          1,
        );

        const retryAt = new Date(base.getTime() + 1_000);
        const failed = await failTrainingAnalysisJob(prisma, {
          sessionId,
          ownerToken: acquired.ownerToken,
          errorMessage: "temporary provider failure",
          retryable: true,
          retryDelayMs: 5_000,
          now: retryAt,
        });
        assert.equal(failed.state, "retry-scheduled");
        assert.equal(failed.job.status, "RETRY_WAIT");
        assert.equal(
          failed.job.nextAttemptAt.getTime(),
          retryAt.getTime() + 5_000,
        );
        assert.equal(
          (
            await acquireTrainingAnalysisJob(prisma, {
              sessionId,
              now: new Date(retryAt.getTime() + 1_000),
            })
          ).state,
          "backoff",
        );

        const retried = await acquireTrainingAnalysisJob(prisma, {
          sessionId,
          now: new Date(retryAt.getTime() + 6_000),
        });
        assert.equal(retried.state, "acquired");
        assert.equal(retried.job.attempt, 2);
        assert.equal(
          await completeTrainingAnalysisJob(prisma, {
            sessionId,
            ownerToken: retried.ownerToken,
          }),
          true,
        );
        const completed = await prisma.asyncJob.findUniqueOrThrow({
          where: { jobKey: trainingAnalysisJobKey(sessionId) },
        });
        assert.equal(completed.status, "COMPLETED");
        assert.equal(completed.payloadJson, null);
        assert.equal(completed.ownerToken, "");
        assert.equal(
          await completeTrainingAnalysisJob(prisma, {
            sessionId,
            ownerToken: retried.ownerToken,
          }),
          true,
        );
      });

      await t.test("显式强制重试重置次数并持久化 force 参数", async () => {
        const sessionId = `${prefix}-forced`;
        sessionIds.push(sessionId);
        await queueTrainingAnalysisJob(prisma, {
          sessionId,
          maxAttempts: 1,
        });
        const acquired = await acquireTrainingAnalysisJob(prisma, {
          sessionId,
          now: base,
        });
        assert.equal(acquired.state, "acquired");
        const terminal = await failTrainingAnalysisJob(prisma, {
          sessionId,
          ownerToken: acquired.ownerToken,
          errorMessage: "terminal",
          retryable: true,
          now: base,
        });
        assert.equal(terminal.state, "failed");
        assert.equal(terminal.job.status, "FAILED");

        const queued = await queueTrainingAnalysisJob(prisma, {
          sessionId,
          forceRegeneration: true,
        });
        assert.equal(queued.state, "queued");
        assert.equal(queued.job.status, "PENDING");
        assert.equal(queued.job.attempt, 0);
        assert.equal(queued.job.maxAttempts, 3);
        assert.equal(queued.job.errorMessage, null);
        assert.deepEqual(parseTrainingAnalysisJobPayload(queued.job), {
          forceRegeneration: true,
        });
      });

      await t.test("资源限制延期遵循 Retry-After 且不消耗任务尝试次数", async () => {
        const sessionId = `${prefix}-resource-deferred`;
        sessionIds.push(sessionId);
        await queueTrainingAnalysisJob(prisma, { sessionId });
        const acquired = await acquireTrainingAnalysisJob(prisma, {
          sessionId,
          now: base,
        });
        assert.equal(acquired.state, "acquired");
        assert.equal(acquired.job.attempt, 1);

        const deferredAt = new Date(base.getTime() + 1_000);
        const retryDelayMs = 60 * 60_000;
        const deferred = await deferTrainingAnalysisJob(prisma, {
          sessionId,
          ownerToken: acquired.ownerToken,
          errorMessage: "daily budget exhausted",
          retryDelayMs,
          now: deferredAt,
        });
        assert.equal(deferred.state, "deferred");
        assert.equal(deferred.job.status, "RETRY_WAIT");
        assert.equal(deferred.job.attempt, 0);
        assert.equal(
          deferred.job.nextAttemptAt.getTime(),
          deferredAt.getTime() + retryDelayMs,
        );

        assert.equal(
          (
            await acquireTrainingAnalysisJob(prisma, {
              sessionId,
              now: new Date(deferredAt.getTime() + retryDelayMs - 1),
            })
          ).state,
          "backoff",
        );
        const retried = await acquireTrainingAnalysisJob(prisma, {
          sessionId,
          now: new Date(deferredAt.getTime() + retryDelayMs + 1),
        });
        assert.equal(retried.state, "acquired");
        assert.equal(retried.job.attempt, 1);
        assert.equal(
          await completeTrainingAnalysisJob(prisma, {
            sessionId,
            ownerToken: retried.ownerToken,
          }),
          true,
        );
      });

      await t.test("过期租约可被新 owner 接管", async () => {
        const sessionId = `${prefix}-takeover`;
        sessionIds.push(sessionId);
        await queueTrainingAnalysisJob(prisma, { sessionId });
        const first = await acquireTrainingAnalysisJob(prisma, {
          sessionId,
          now: base,
          leaseMs: 1_000,
        });
        assert.equal(first.state, "acquired");
        const expiredAt = new Date(base.getTime() + 1_500);
        assert.equal(
          await completeTrainingAnalysisJob(prisma, {
            sessionId,
            ownerToken: first.ownerToken,
            now: expiredAt,
          }),
          false,
        );
        assert.equal(
          (
            await failTrainingAnalysisJob(prisma, {
              sessionId,
              ownerToken: first.ownerToken,
              errorMessage: "late failure",
              now: expiredAt,
            })
          ).state,
          "owner-lost",
        );
        const second = await acquireTrainingAnalysisJob(prisma, {
          sessionId,
          now: new Date(base.getTime() + 2_000),
        });
        assert.equal(second.state, "acquired");
        assert.notEqual(second.ownerToken, first.ownerToken);
        assert.equal(second.job.attempt, 2);
      });
    } finally {
      await prisma.asyncJob.deleteMany({
        where: {
          jobType: TRAINING_ANALYSIS_JOB_TYPE,
          resourceId: { in: sessionIds },
        },
      });
      await prisma.$disconnect();
    }
  },
);
