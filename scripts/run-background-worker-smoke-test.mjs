import { spawn } from "node:child_process";
import { mkdir, rm } from "node:fs/promises";
import path from "node:path";

import { PrismaClient } from "@prisma/client";
import {
  readBackgroundWorkerHealth,
  TRAINING_ANALYSIS_CAPABILITY,
  TRAINING_TRANSCRIPTION_CAPABILITY,
} from "../lib/worker-heartbeat.mjs";
import { queueTrainingAnalysisJob } from "../lib/training-analysis-job.mjs";

const isWindows = process.platform === "win32";
const npmCommand = isWindows ? "npm.cmd" : "npm";
const pythonCommand = isWindows ? "python.exe" : "python3";
const databaseUrl =
  process.env.BACKGROUND_WORKER_TEST_DATABASE_URL ||
  "file:./background-worker-test.db";

const testEnv = {
  ...process.env,
  AUTH_ENABLED: "false",
  DATABASE_URL: databaseUrl,
  BACKGROUND_TASK_MODE: "external",
  BACKGROUND_WORKER_HEARTBEAT_INTERVAL_MS: "1000",
  BACKGROUND_WORKER_HEARTBEAT_TTL_MS: "5000",
  BACKGROUND_WORKER_POLL_INTERVAL_MS: "1000",
  UPLOAD_MAINTENANCE_ENABLED: "false",
};

let workerProcess = null;

function sqlitePathFromUrl(url) {
  if (!url.startsWith("file:")) return null;
  const sqlitePath = url.slice("file:".length);
  return path.isAbsolute(sqlitePath)
    ? sqlitePath
    : path.resolve("prisma", sqlitePath);
}

function runCommand(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      stdio: "inherit",
      shell: isWindows,
      env: testEnv,
    });
    child.on("error", reject);
    child.on("exit", (code, signal) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(
        new Error(
          `${command} ${args.join(" ")} failed with ${signal || `code ${code}`}`,
        ),
      );
    });
  });
}

async function waitForWorkerOutcome(prisma, sessionId) {
  for (let attempt = 1; attempt <= 120; attempt += 1) {
    if (
      workerProcess &&
      (workerProcess.exitCode !== null || workerProcess.signalCode !== null)
    ) {
      throw new Error("Background worker exited before publishing a heartbeat.");
    }

    const health = await readBackgroundWorkerHealth(prisma, {
      requiredCapabilities: [
        TRAINING_ANALYSIS_CAPABILITY,
        TRAINING_TRANSCRIPTION_CAPABILITY,
      ],
    });
    const [job, session] = await Promise.all([
      prisma.asyncJob.findUnique({
        where: { jobKey: `training-analysis:${sessionId}` },
      }),
      prisma.trainingSession.findUnique({
        where: { id: sessionId },
        include: { currentAnalysis: true },
      }),
    ]);
    if (
      health.healthy &&
      job?.status === "COMPLETED" &&
      session?.currentAnalysis?.status === "COMPLETED"
    ) {
      return { health, analysis: session.currentAnalysis };
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(
    "Timed out waiting for the worker heartbeat and queued report completion.",
  );
}

async function stopWorker() {
  if (
    !workerProcess ||
    workerProcess.exitCode !== null ||
    workerProcess.signalCode !== null
  ) {
    return;
  }

  if (isWindows) {
    await new Promise((resolve) => {
      const killer = spawn(
        "taskkill",
        ["/PID", String(workerProcess.pid), "/T", "/F"],
        { windowsHide: true },
      );
      killer.on("exit", resolve);
      killer.on("error", resolve);
    });
    return;
  }

  try {
    process.kill(-workerProcess.pid, "SIGTERM");
  } catch {
    workerProcess.kill("SIGTERM");
  }
}

async function main() {
  const dbPath = sqlitePathFromUrl(databaseUrl);
  if (!dbPath || !/test/i.test(path.basename(dbPath))) {
    throw new Error(
      "BACKGROUND_WORKER_TEST_DATABASE_URL must be a dedicated SQLite file whose name contains test.",
    );
  }

  await mkdir(path.dirname(dbPath), { recursive: true });
  await Promise.all(
    [dbPath, `${dbPath}-journal`, `${dbPath}-shm`, `${dbPath}-wal`].map(
      (target) => rm(target, { force: true }),
    ),
  );
  console.log(`[worker-smoke] database=${databaseUrl}`);
  await runCommand(pythonCommand, ["scripts/apply-sqlite-test-migrations.py"]);

  const prisma = new PrismaClient({
    datasources: { db: { url: databaseUrl } },
  });
  try {
    const fixtureId = `worker-smoke-${process.pid}-${Date.now()}`;
    const userId = `${fixtureId}-user`;
    const projectId = `${fixtureId}-project`;
    const sessionId = `${fixtureId}-session`;
    await prisma.user.create({
      data: {
        id: userId,
        name: "Worker smoke user",
        email: `${fixtureId}@example.test`,
      },
    });
    await prisma.project.create({
      data: {
        id: projectId,
        ownerId: userId,
        name: "Worker smoke project",
        field: "TEST",
        stage: "TEST",
        summary: "fixture",
        coreTechnology: "fixture",
        applicationScenario: "fixture",
        businessModel: "fixture",
        cooperationDemand: "fixture",
      },
    });
    const now = new Date();
    await prisma.trainingSession.create({
      data: {
        id: sessionId,
        projectId,
        status: "QA_ENDED",
        pitchStartedAt: new Date(now.getTime() - 60_000),
        pitchEndedAt: now,
        pitchDurationSec: 60,
        qaEndedAt: now,
      },
    });
    await queueTrainingAnalysisJob(prisma, { sessionId });
    workerProcess = spawn(npmCommand, ["run", "worker:start"], {
      stdio: "inherit",
      env: testEnv,
      shell: isWindows,
      detached: !isWindows,
    });

    const { health, analysis } = await waitForWorkerOutcome(prisma, sessionId);
    console.log(
      `[worker-smoke] healthy worker=${health.latest?.id} capabilities=${health.latest?.capabilities.join(",")} report=${analysis.id}`,
    );
  } finally {
    await stopWorker();
    await prisma.$disconnect();
  }
}

main().catch(async (error) => {
  await stopWorker();
  console.error(
    "[worker-smoke] failed:",
    error instanceof Error ? error.message : String(error),
  );
  process.exitCode = 1;
});
