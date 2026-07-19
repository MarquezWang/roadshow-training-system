import { spawn } from "node:child_process";
import { mkdir, rm } from "node:fs/promises";
import path from "node:path";

const isWindows = process.platform === "win32";
const npmCommand = isWindows ? "npm.cmd" : "npm";
const pythonCommand = isWindows ? "python.exe" : "python3";
const port = process.env.STABILITY_TEST_PORT || "3210";
const databaseUrl =
  process.env.STABILITY_TEST_DATABASE_URL ||
  "file:./test-stability.db";
const baseUrl =
  process.env.STABILITY_TEST_BASE_URL || `http://127.0.0.1:${port}`;

const testEnv = {
  ...process.env,
  AUTH_ENABLED: "false",
  DYNAMIC_FOLLOWUP_EXPERIMENT: "true",
  DATABASE_URL: databaseUrl,
  STABILITY_TEST_DATABASE_URL: databaseUrl,
  STABILITY_TEST_BASE_URL: baseUrl,
  STABILITY_TEST_DISABLE_EMBEDDED_WORKERS: "true",
};

let serverProcess = null;

function sqlitePathFromUrl(url) {
  if (!url.startsWith("file:")) {
    return null;
  }

  const sqlitePath = url.slice("file:".length);

  if (path.isAbsolute(sqlitePath)) {
    return sqlitePath;
  }

  return path.resolve("prisma", sqlitePath);
}

function runCommand(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      stdio: options.stdio || "inherit",
      shell: isWindows,
      env: options.env || testEnv,
      detached: options.detached || false,
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

async function waitForServer() {
  for (let attempt = 1; attempt <= 60; attempt += 1) {
    if (serverProcess?.exitCode !== null) {
      throw new Error("Next dev server exited before becoming ready.");
    }

    try {
      const response = await fetch(baseUrl, { cache: "no-store" });
      if (response.ok) {
        return;
      }
    } catch {
      // Keep waiting.
    }

    await new Promise((resolve) => setTimeout(resolve, 2000));
  }

  throw new Error(`Timed out waiting for test server at ${baseUrl}.`);
}

async function stopServer() {
  if (!serverProcess || serverProcess.exitCode !== null) {
    return;
  }

  if (isWindows) {
    await new Promise((resolve) => {
      const killer = spawn("taskkill", [
        "/PID",
        String(serverProcess.pid),
        "/T",
        "/F",
      ]);
      killer.on("exit", resolve);
      killer.on("error", resolve);
    });
    return;
  }

  try {
    process.kill(-serverProcess.pid, "SIGTERM");
  } catch {
    try {
      serverProcess.kill("SIGTERM");
    } catch {
      // Ignore cleanup failures.
    }
  }
}

async function main() {
  const dbPath = sqlitePathFromUrl(databaseUrl);

  if (!dbPath) {
    throw new Error(
      "STABILITY_TEST_DATABASE_URL must be a dedicated SQLite file: URL.",
    );
  }

  await mkdir(path.dirname(dbPath), { recursive: true });
  console.log(`[stability] database=${databaseUrl}`);
  console.log(`[stability] server=${baseUrl}`);

  await Promise.all(
    [dbPath, `${dbPath}-journal`, `${dbPath}-shm`, `${dbPath}-wal`].map(
      (target) => rm(target, { force: true }),
    ),
  );
  await runCommand(pythonCommand, ["scripts/apply-sqlite-test-migrations.py"]);

  serverProcess = spawn(npmCommand, ["run", "dev", "--", "-p", port], {
    stdio: "inherit",
    env: testEnv,
    shell: isWindows,
    detached: !isWindows,
  });

  try {
    await waitForServer();
    await runCommand(npmCommand, ["run", "test:stability"], {
      env: testEnv,
    });
  } finally {
    await stopServer();
  }
}

main().catch(async (error) => {
  await stopServer();
  console.error("[stability] failed:", error.message);
  process.exitCode = 1;
});
