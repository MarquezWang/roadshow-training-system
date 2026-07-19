import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  assertProductionBackgroundTaskMode,
  backgroundTaskModes,
  getBackgroundTaskMode,
  runsBackgroundTasksInWebProcess,
  usesExternalBackgroundWorker,
} from "../../lib/background-task-mode.mjs";
import {
  BACKGROUND_WORKER_TYPE,
  expireWorkerHeartbeat,
  getBackgroundWorkerTiming,
  readBackgroundWorkerHealth,
  recordWorkerHeartbeat,
  TRAINING_ANALYSIS_CAPABILITY,
  TRAINING_TRANSCRIPTION_CAPABILITY,
  UPLOAD_MAINTENANCE_CAPABILITY,
} from "../../lib/worker-heartbeat.mjs";

const databaseUrl = process.env.STABILITY_TEST_DATABASE_URL?.trim() ?? "";

function safetySkipReason() {
  const normalized = databaseUrl.toLowerCase();
  if (!normalized.startsWith("file:")) return "需要专用 SQLite 测试数据库。";
  if (!normalized.includes("test") && !normalized.includes("stability")) {
    return "测试数据库名称必须包含 test 或 stability。";
  }
  return null;
}

test("后台任务模式默认嵌入，且只接受显式的两种拓扑", () => {
  assert.equal(getBackgroundTaskMode({}), backgroundTaskModes.embedded);
  assert.equal(
    getBackgroundTaskMode({ BACKGROUND_TASK_MODE: " EXTERNAL " }),
    backgroundTaskModes.external,
  );
  assert.equal(usesExternalBackgroundWorker({ BACKGROUND_TASK_MODE: "external" }), true);
  assert.equal(runsBackgroundTasksInWebProcess({}), true);
  assert.equal(
    assertProductionBackgroundTaskMode({
      NODE_ENV: "production",
      BACKGROUND_TASK_MODE: "external",
    }),
    "external",
  );
  assert.throws(
    () => assertProductionBackgroundTaskMode({ NODE_ENV: "production" }),
    /Production requires BACKGROUND_TASK_MODE=external/,
  );
  assert.throws(
    () => getBackgroundTaskMode({ BACKGROUND_TASK_MODE: "sidecar" }),
    /embedded or external/,
  );
});

test("Worker 心跳、有效期和轮询时间具有硬边界", () => {
  assert.deepEqual(getBackgroundWorkerTiming({}), {
    heartbeatIntervalMs: 5_000,
    heartbeatTtlMs: 30_000,
    pollIntervalMs: 5_000,
  });
  assert.throws(
    () =>
      getBackgroundWorkerTiming({
        BACKGROUND_WORKER_HEARTBEAT_INTERVAL_MS: "4000",
        BACKGROUND_WORKER_HEARTBEAT_TTL_MS: "5000",
      }),
    /at least twice/,
  );
  assert.throws(
    () =>
      getBackgroundWorkerTiming({
        BACKGROUND_WORKER_POLL_INTERVAL_MS: "999",
      }),
    /BACKGROUND_WORKER_POLL_INTERVAL_MS/,
  );
});

test("external Web 只入队报告，Worker 才加载报告执行器", async () => {
  const [route, worker, client, runtime] = await Promise.all([
    readFile(
      new URL(
        "../../app/training/[sessionId]/analysis/route.ts",
        import.meta.url,
      ),
      "utf8",
    ),
    readFile(
      new URL("../../lib/training-analysis-worker.ts", import.meta.url),
      "utf8",
    ),
    readFile(
      new URL(
        "../../app/training/[sessionId]/report/use-report-analysis-generation.ts",
        import.meta.url,
      ),
      "utf8",
    ),
    readFile(
      new URL("../../lib/background-worker-runtime.ts", import.meta.url),
      "utf8",
    ),
  ]);

  assert.match(route, /usesExternalBackgroundWorker\(\)/);
  assert.match(route, /queueTrainingAnalysisJob/);
  assert.match(route, /status: 202/);
  assert.match(worker, /executeTrainingAnalysisGeneration/);
  assert.match(worker, /failTrainingAnalysisJob/);
  assert.match(worker, /error instanceof AIResourceLimitError/);
  assert.match(worker, /deferTrainingAnalysisJob/);
  assert.match(worker, /resourceLimitError\?\.retryable === true/);
  assert.match(worker, /resourceLimitError\.retryable/);
  assert.match(
    worker,
    /Math\.max\(1, resourceLimitError\.retryAfterSec\) \* 1_000/,
  );
  assert.match(client, /body\?\.queued/);
  assert.match(client, /analysisJobActive/);
  assert.match(runtime, /TRAINING_ANALYSIS_CAPABILITY/);
  assert.match(runtime, /recoverDueTrainingAnalyses/);
});

test("独立 Worker 在加载数据库和任务模块前先读取 Next 环境文件", async () => {
  const source = await readFile(
    new URL("../../scripts/background-worker.ts", import.meta.url),
    "utf8",
  );
  const envLoadIndex = source.indexOf("loadEnvConfig(process.cwd()");
  const runtimeImportIndex = source.indexOf(
    'import("@/lib/background-worker-runtime")',
  );
  const prismaImportIndex = source.indexOf('import("@/lib/prisma")');

  assert.match(source, /import \{ loadEnvConfig \} from "@next\/env"/);
  assert.ok(envLoadIndex >= 0);
  assert.ok(runtimeImportIndex > envLoadIndex);
  assert.ok(prismaImportIndex > envLoadIndex);
  assert.doesNotMatch(
    source,
    /import \{ runBackgroundWorker \} from "@\/lib\/background-worker-runtime"/,
  );
});

test(
  "数据库心跳只有在未过期且覆盖所需能力时才健康",
  { skip: safetySkipReason() || false },
  async () => {
    const { PrismaClient } = await import("@prisma/client");
    const prisma = new PrismaClient({
      datasources: { db: { url: databaseUrl } },
    });
    const workerId = `worker-policy-${randomUUID()}`;
    const base = new Date(Date.now() + 60_000);
    const identity = {
      id: workerId,
      workerType: BACKGROUND_WORKER_TYPE,
      hostname: "worker-policy.test",
      processId: process.pid,
      startedAt: base,
    };

    try {
      await recordWorkerHeartbeat(prisma, {
        identity,
        capabilities: [
          TRAINING_ANALYSIS_CAPABILITY,
          TRAINING_TRANSCRIPTION_CAPABILITY,
        ],
        now: base,
        ttlMs: 10_000,
      });

      const transcriptionHealth = await readBackgroundWorkerHealth(prisma, {
        now: new Date(base.getTime() + 1_000),
        requiredCapabilities: [
          TRAINING_ANALYSIS_CAPABILITY,
          TRAINING_TRANSCRIPTION_CAPABILITY,
        ],
      });
      assert.equal(transcriptionHealth.healthy, true);
      assert.equal(transcriptionHealth.capableCount, 1);

      const maintenanceHealth = await readBackgroundWorkerHealth(prisma, {
        now: new Date(base.getTime() + 1_000),
        requiredCapabilities: [UPLOAD_MAINTENANCE_CAPABILITY],
      });
      assert.equal(maintenanceHealth.healthy, false);
      assert.equal(maintenanceHealth.activeCount, 1);

      const expiredAt = new Date(base.getTime() + 2_000);
      await expireWorkerHeartbeat(prisma, workerId, expiredAt);
      const expiredHealth = await readBackgroundWorkerHealth(prisma, {
        now: expiredAt,
        requiredCapabilities: [TRAINING_TRANSCRIPTION_CAPABILITY],
      });
      assert.equal(expiredHealth.healthy, false);
      assert.equal(expiredHealth.activeCount, 0);
    } finally {
      await prisma.workerHeartbeat.deleteMany({ where: { id: workerId } });
      await prisma.$disconnect();
    }
  },
);
