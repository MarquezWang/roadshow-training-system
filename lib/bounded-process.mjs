import { spawn } from "node:child_process";

const DEFAULT_TIMEOUT_MS = 60_000;
const DEFAULT_MAX_OUTPUT_BYTES = 1024 * 1024;

export class BoundedProcessError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = "BoundedProcessError";
    this.code = code;
    this.details = details;
  }
}

function safePositiveInteger(value, fallback) {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : fallback;
}

async function terminateWindowsProcessTree(child) {
  if (!child.pid) return;

  await new Promise((resolve) => {
    const killer = spawn(
      "taskkill",
      ["/pid", String(child.pid), "/t", "/f"],
      { stdio: "ignore", windowsHide: true },
    );
    const timeoutId = setTimeout(() => {
      killer.kill("SIGKILL");
      resolve();
    }, 5_000);
    killer.once("error", () => {
      clearTimeout(timeoutId);
      resolve();
    });
    killer.once("close", () => {
      clearTimeout(timeoutId);
      resolve();
    });
  });
  child.kill("SIGKILL");
}

async function terminateProcessTree(child) {
  if (process.platform === "win32") {
    await terminateWindowsProcessTree(child);
    return;
  }

  if (child.pid) {
    try {
      process.kill(-child.pid, "SIGKILL");
      return;
    } catch {
      // The process may have exited between the timeout and termination.
    }
  }
  child.kill("SIGKILL");
}

/**
 * @param {string} command
 * @param {string[]} args
 * @param {{
 *   cwd?: string;
 *   env?: Record<string, string | undefined>;
 *   signal?: AbortSignal;
 *   timeoutMs?: number;
 *   maxOutputBytes?: number;
 * }} [options]
 */
export async function runBoundedProcess(
  command,
  args,
  {
    cwd,
    env,
    signal,
    timeoutMs = DEFAULT_TIMEOUT_MS,
    maxOutputBytes = DEFAULT_MAX_OUTPUT_BYTES,
  } = {},
) {
  const hardTimeoutMs = safePositiveInteger(timeoutMs, DEFAULT_TIMEOUT_MS);
  const outputLimit = safePositiveInteger(
    maxOutputBytes,
    DEFAULT_MAX_OUTPUT_BYTES,
  );

  if (signal?.aborted) {
    throw new BoundedProcessError("ABORTED", "子进程任务已取消。");
  }

  const child = spawn(/* turbopackIgnore: true */ command, args, {
    cwd,
    env,
    windowsHide: true,
    detached: process.platform !== "win32",
    shell: false,
    stdio: ["ignore", "pipe", "pipe"],
  });

  return new Promise((resolve, reject) => {
    let settled = false;
    let stdoutBytes = 0;
    let stderrBytes = 0;
    const stdoutChunks = [];
    const stderrChunks = [];

    const cleanup = () => {
      clearTimeout(timeoutId);
      signal?.removeEventListener("abort", onAbort);
    };
    const rejectAfterTermination = async (error) => {
      if (settled) return;
      settled = true;
      cleanup();
      await terminateProcessTree(child).catch(() => undefined);
      reject(error);
    };
    const onAbort = () =>
      void rejectAfterTermination(
        new BoundedProcessError("ABORTED", "子进程任务已取消。"),
      );
    const timeoutId = setTimeout(
      () =>
        void rejectAfterTermination(
          new BoundedProcessError(
            "TIMEOUT",
            `子进程运行超过 ${hardTimeoutMs}ms，已终止。`,
          ),
        ),
      hardTimeoutMs,
    );

    signal?.addEventListener("abort", onAbort, { once: true });
    child.stdout.on("data", (chunk) => {
      stdoutBytes += chunk.length;
      if (stdoutBytes + stderrBytes > outputLimit) {
        void rejectAfterTermination(
          new BoundedProcessError(
            "OUTPUT_LIMIT",
            "子进程输出超过允许大小，已终止。",
          ),
        );
        return;
      }
      stdoutChunks.push(Buffer.from(chunk));
    });
    child.stderr.on("data", (chunk) => {
      stderrBytes += chunk.length;
      if (stdoutBytes + stderrBytes > outputLimit) {
        void rejectAfterTermination(
          new BoundedProcessError(
            "OUTPUT_LIMIT",
            "子进程输出超过允许大小，已终止。",
          ),
        );
        return;
      }
      stderrChunks.push(Buffer.from(chunk));
    });
    child.once("error", (error) => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(
        new BoundedProcessError("SPAWN_FAILED", error.message, {
          cause: error,
        }),
      );
    });
    child.once("close", (code, processSignal) => {
      if (settled) return;
      settled = true;
      cleanup();
      const stdout = Buffer.concat(stdoutChunks).toString("utf8");
      const stderr = Buffer.concat(stderrChunks).toString("utf8");
      if (code === 0) {
        resolve({ stdout, stderr, code });
        return;
      }
      reject(
        new BoundedProcessError(
          "NON_ZERO_EXIT",
          `子进程退出码为 ${code ?? "null"}。`,
          { stdout, stderr, code, signal: processSignal },
        ),
      );
    });
  });
}
