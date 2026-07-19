import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { access, mkdir, readFile, rm } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

import {
  abortableTranscriptionDelay,
  runWithTranscriptionAbort,
} from "../../lib/transcription-abort.mjs";
import {
  createTranscriptionLimiter,
  TranscriptionResourceError,
} from "../../lib/transcription-resource-boundary.mjs";
import {
  streamWebBodyToFile,
  UploadStreamError,
} from "../../lib/stream-upload.mjs";

function bodyFromChunks(chunks) {
  return new ReadableStream({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(Buffer.from(chunk));
      controller.close();
    },
  });
}

test("ASR timeout aborts the provider signal and returns promptly", async () => {
  let providerSignal = null;
  const startedAt = Date.now();
  await assert.rejects(
    runWithTranscriptionAbort({ timeoutMs: 25 }, async (signal) => {
      providerSignal = signal;
      await new Promise(() => {});
    }),
    /timed out after 25ms/,
  );
  assert.equal(providerSignal?.aborted, true);
  assert.ok(Date.now() - startedAt < 500);
});

test("poll delays stop immediately when the ASR signal is aborted", async () => {
  const controller = new AbortController();
  const pending = abortableTranscriptionDelay(10_000, controller.signal);
  controller.abort(new Error("lease lost"));
  await assert.rejects(pending, /lease lost/);
});

test("ASR concurrency limiter bounds active provider work and queue time", async () => {
  const limiter = createTranscriptionLimiter(1);
  const release = await limiter.acquire();
  assert.equal(limiter.activeCount, 1);

  await assert.rejects(
    limiter.acquire({ timeoutMs: 20 }),
    (error) =>
      error instanceof TranscriptionResourceError &&
      error.code === "QUEUE_TIMEOUT",
  );
  assert.equal(limiter.activeCount, 1);
  assert.equal(limiter.pendingCount, 0);

  release();
  assert.equal(limiter.activeCount, 0);
});

test("raw recording upload streams to disk and rejects unsafe boundaries", async (t) => {
  const directory = path.resolve(
    "tmp",
    `stream-upload-test-${randomUUID()}`,
  );
  await mkdir(directory, { recursive: true });

  async function assertMissing(filePath) {
    await assert.rejects(access(filePath));
  }

  try {
    await t.test("successful chunks are written without buffering contract", async () => {
      const filePath = path.join(directory, "ok.webm");
      const result = await streamWebBodyToFile(
        bodyFromChunks(["abc", "def"]),
        filePath,
        { maxBytes: 10, expectedBytes: 6 },
      );
      assert.equal(result.receivedBytes, 6);
      assert.equal((await readFile(filePath)).toString(), "abcdef");
    });

    await t.test("oversized streams remove the partial file", async () => {
      const filePath = path.join(directory, "large.webm");
      await assert.rejects(
        streamWebBodyToFile(bodyFromChunks(["1234", "5678"]), filePath, {
          maxBytes: 6,
        }),
        (error) => error instanceof UploadStreamError && error.code === "TOO_LARGE",
      );
      await assertMissing(filePath);
    });

    await t.test("truncated streams remove the partial file", async () => {
      const filePath = path.join(directory, "truncated.webm");
      await assert.rejects(
        streamWebBodyToFile(bodyFromChunks(["1234"]), filePath, {
          maxBytes: 10,
          expectedBytes: 8,
        }),
        (error) =>
          error instanceof UploadStreamError && error.code === "SIZE_MISMATCH",
      );
      await assertMissing(filePath);
    });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
