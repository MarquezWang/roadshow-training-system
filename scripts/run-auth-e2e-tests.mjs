import { spawn } from "node:child_process";
import { mkdir, rm } from "node:fs/promises";
import path from "node:path";

const isWindows = process.platform === "win32";
const npmCommand = isWindows ? "npm.cmd" : "npm";
const pythonCommand = isWindows ? "python.exe" : "python3";
const port = process.env.AUTH_E2E_PORT || "3220";
const databaseUrl =
  process.env.AUTH_E2E_DATABASE_URL || "file:./auth-e2e-test.db";
const baseUrl =
  process.env.AUTH_E2E_BASE_URL || `http://127.0.0.1:${port}`;

const testEnv = {
  ...process.env,
  AUTH_ENABLED: "true",
  AUTH_SECRET:
    process.env.AUTH_E2E_SECRET ||
    "auth-e2e-secret-with-more-than-thirty-two-characters",
  AUTH_SECRET_PREVIOUS: "",
  TRUSTED_PROXY_HOPS: "0",
  DATABASE_URL: databaseUrl,
  AUTH_E2E_DATABASE_URL: databaseUrl,
  AUTH_E2E_BASE_URL: baseUrl,
};

let serverProcess = null;

function sqlitePathFromUrl(url) {
  if (!url.startsWith("file:")) {
    return null;
  }

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

async function waitForServer() {
  for (let attempt = 1; attempt <= 60; attempt += 1) {
    if (serverProcess?.exitCode !== null) {
      throw new Error("Next dev server exited before becoming ready.");
    }

    try {
      const response = await fetch(`${baseUrl}/login`, {
        cache: "no-store",
        redirect: "manual",
      });
      if (response.status === 200) {
        return;
      }
    } catch {
      // Keep waiting while Next compiles the login route.
    }

    await new Promise((resolve) => setTimeout(resolve, 2_000));
  }

  throw new Error(`Timed out waiting for auth E2E server at ${baseUrl}.`);
}

async function stopServer() {
  if (!serverProcess || serverProcess.exitCode !== null) {
    return;
  }

  if (isWindows) {
    await new Promise((resolve) => {
      const killer = spawn(
        "taskkill",
        ["/PID", String(serverProcess.pid), "/T", "/F"],
        { windowsHide: true },
      );
      killer.on("exit", resolve);
      killer.on("error", resolve);
    });
    return;
  }

  try {
    process.kill(-serverProcess.pid, "SIGTERM");
  } catch {
    serverProcess.kill("SIGTERM");
  }
}

async function main() {
  const dbPath = sqlitePathFromUrl(databaseUrl);
  if (!dbPath || !/test/i.test(path.basename(dbPath))) {
    throw new Error(
      "AUTH_E2E_DATABASE_URL must be a dedicated SQLite file whose name contains test.",
    );
  }

  await mkdir(path.dirname(dbPath), { recursive: true });
  await Promise.all(
    [dbPath, `${dbPath}-journal`, `${dbPath}-shm`, `${dbPath}-wal`].map(
      (target) => rm(target, { force: true }),
    ),
  );

  console.log(`[auth-e2e] database=${databaseUrl}`);
  console.log(`[auth-e2e] server=${baseUrl}`);
  await runCommand(pythonCommand, ["scripts/apply-sqlite-test-migrations.py"]);

  serverProcess = spawn(npmCommand, ["run", "dev", "--", "-p", port], {
    stdio: "inherit",
    env: testEnv,
    shell: isWindows,
    detached: !isWindows,
  });

  try {
    await waitForServer();
    await runCommand(npmCommand, ["run", "test:auth:e2e"]);
  } finally {
    await stopServer();
  }
}

main().catch(async (error) => {
  await stopServer();
  console.error("[auth-e2e] failed:", error.message);
  process.exitCode = 1;
});
