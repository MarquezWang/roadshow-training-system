import { randomUUID } from "node:crypto";
import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";

import { BoundedProcessError, runBoundedProcess } from "./bounded-process.mjs";

const DEFAULT_PARSE_TIMEOUT_MS = 60_000;
const DEFAULT_QUEUE_TIMEOUT_MS = 30_000;
const DEFAULT_MAX_CONCURRENCY = 2;
const RESULT_MARKER = "__DOCUMENT_PARSER_RESULT__";

function positiveInteger(value, fallback, maximum = Number.MAX_SAFE_INTEGER) {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0
    ? Math.min(parsed, maximum)
    : fallback;
}

export class DocumentParserBoundaryError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "DocumentParserBoundaryError";
    this.code = code;
  }
}

export function createDocumentParseLimiter(maxConcurrency) {
  const limit = positiveInteger(maxConcurrency, DEFAULT_MAX_CONCURRENCY, 8);
  let active = 0;
  const queue = [];

  function dispatch() {
    while (active < limit && queue.length > 0) {
      const waiter = queue.shift();
      if (waiter.cancelled) continue;
      active += 1;
      waiter.resolve(() => {
        if (waiter.released) return;
        waiter.released = true;
        active -= 1;
        dispatch();
      });
    }
  }

  function acquire({ signal, timeoutMs = DEFAULT_QUEUE_TIMEOUT_MS } = {}) {
    if (signal?.aborted) {
      return Promise.reject(
        new DocumentParserBoundaryError("ABORTED", "文档解析已取消。"),
      );
    }

    return new Promise((resolve, reject) => {
      const waiter = { resolve, reject, cancelled: false, released: false };
      let timeoutId = null;

      const cleanup = () => {
        if (timeoutId !== null) clearTimeout(timeoutId);
        signal?.removeEventListener("abort", onAbort);
      };
      const cancel = (error) => {
        if (waiter.cancelled || waiter.released) return;
        waiter.cancelled = true;
        cleanup();
        reject(error);
      };
      const onAbort = () =>
        cancel(new DocumentParserBoundaryError("ABORTED", "文档解析已取消。"));

      waiter.resolve = (release) => {
        cleanup();
        resolve(release);
      };
      timeoutId = setTimeout(
        () =>
          cancel(
            new DocumentParserBoundaryError(
              "QUEUE_TIMEOUT",
              "文档解析任务拥堵，请稍后重试。",
            ),
          ),
        positiveInteger(timeoutMs, DEFAULT_QUEUE_TIMEOUT_MS),
      );
      signal?.addEventListener("abort", onAbort, { once: true });
      queue.push(waiter);
      dispatch();
    });
  }

  return {
    acquire,
    get activeCount() {
      return active;
    },
    get pendingCount() {
      return queue.filter((waiter) => !waiter.cancelled).length;
    },
  };
}

const globalLimiter = createDocumentParseLimiter(
  positiveInteger(
    process.env.DOCUMENT_PARSE_MAX_CONCURRENCY,
    DEFAULT_MAX_CONCURRENCY,
    8,
  ),
);

/**
 * @param {{
 *   inputPath: string;
 *   fileType: string;
 *   signal?: AbortSignal;
 *   timeoutMs?: number;
 *   queueTimeoutMs?: number;
 *   workerPath?: string;
 *   limiter?: ReturnType<typeof createDocumentParseLimiter>;
 * }} options
 */
export async function runDocumentParserWorker({
  inputPath,
  fileType,
  signal,
  timeoutMs = positiveInteger(
    process.env.DOCUMENT_PARSE_TIMEOUT_MS,
    DEFAULT_PARSE_TIMEOUT_MS,
  ),
  queueTimeoutMs = positiveInteger(
    process.env.DOCUMENT_PARSE_QUEUE_TIMEOUT_MS,
    DEFAULT_QUEUE_TIMEOUT_MS,
  ),
  workerPath = path.resolve(
    /* turbopackIgnore: true */ process.cwd(),
    "lib",
    "document-parser-worker.mjs",
  ),
  limiter = globalLimiter,
}) {
  const release = await limiter.acquire({ signal, timeoutMs: queueTimeoutMs });

  try {
    if (signal?.aborted) {
      throw new DocumentParserBoundaryError("ABORTED", "文档解析已取消。");
    }

    let result;
    try {
      result = await runBoundedProcess(
        process.execPath,
        [
          "--max-old-space-size=256",
          "--max-semi-space-size=32",
          workerPath,
          inputPath,
          fileType,
        ],
        {
          signal,
          timeoutMs: positiveInteger(timeoutMs, DEFAULT_PARSE_TIMEOUT_MS),
          maxOutputBytes: 1024 * 1024,
          env: {
            ...process.env,
            NODE_OPTIONS: "",
          },
        },
      );
    } catch (error) {
      if (error instanceof BoundedProcessError) {
        if (error.code === "TIMEOUT") {
          throw new DocumentParserBoundaryError(
            "TIMEOUT",
            `文档解析超过 ${positiveInteger(timeoutMs, DEFAULT_PARSE_TIMEOUT_MS)}ms，已终止。`,
          );
        }
        if (error.code === "ABORTED") {
          throw new DocumentParserBoundaryError("ABORTED", "文档解析已取消。");
        }
        throw new DocumentParserBoundaryError(
          "WORKER_FAILED",
          "文档解析工作进程异常退出。",
        );
      }
      throw error;
    }

    const markerOffset = result.stdout.lastIndexOf(RESULT_MARKER);
    if (markerOffset < 0) {
      throw new DocumentParserBoundaryError(
        "INVALID_WORKER_OUTPUT",
        "文档解析工作进程未返回有效结果。",
      );
    }

    let message;
    try {
      message = JSON.parse(result.stdout.slice(markerOffset + RESULT_MARKER.length));
    } catch {
      throw new DocumentParserBoundaryError(
        "INVALID_WORKER_OUTPUT",
        "文档解析工作进程返回了无效结果。",
      );
    }

    if (!message?.ok || typeof message.text !== "string") {
      throw new DocumentParserBoundaryError(
        "PARSE_FAILED",
        typeof message?.error === "string"
          ? message.error.slice(0, 1_000)
          : "文档解析失败。",
      );
    }
    if (message.text.length > 100_000) {
      throw new DocumentParserBoundaryError(
        "OUTPUT_TOO_LARGE",
        "文档解析输出超过允许长度。",
      );
    }
    return message.text;
  } finally {
    release();
  }
}

/**
 * @template T
 * @param {Buffer} buffer
 * @param {string} extension
 * @param {(temporaryPath: string) => Promise<T>} operation
 * @param {{ temporaryRoot?: string }} [options]
 * @returns {Promise<T>}
 */
export async function withTemporaryDocumentFile(
  buffer,
  extension,
  operation,
  {
    temporaryRoot = path.resolve(
      /* turbopackIgnore: true */ process.cwd(),
      "tmp",
      "document-parser",
    ),
  } = {},
) {
  const safeExtension = String(extension).replace(/[^a-zA-Z0-9]/g, "").slice(0, 10);
  const temporaryPath = path.join(
    /* turbopackIgnore: true */ temporaryRoot,
    `${randomUUID()}${safeExtension ? `.${safeExtension}` : ""}`,
  );
  await mkdir(/* turbopackIgnore: true */ temporaryRoot, { recursive: true });
  await writeFile(/* turbopackIgnore: true */ temporaryPath, buffer, {
    flag: "wx",
  });

  try {
    return await operation(temporaryPath);
  } finally {
    await rm(/* turbopackIgnore: true */ temporaryPath, { force: true }).catch(
      () => undefined,
    );
    await rm(/* turbopackIgnore: true */ temporaryRoot).catch(() => undefined);
  }
}
