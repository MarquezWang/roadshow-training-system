import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";

function transpileToDataUrl(source) {
  const output = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.ESNext,
      target: ts.ScriptTarget.ES2022,
    },
  }).outputText;

  return `data:text/javascript;base64,${Buffer.from(output).toString("base64")}`;
}

const transcribeErrorUrl = transpileToDataUrl(
  await readFile(
    new URL("../../lib/transcribe-error.ts", import.meta.url),
    "utf8",
  ),
);
const errorsSource = (
  await readFile(
    new URL("../../lib/training-transcribe/errors.ts", import.meta.url),
    "utf8",
  )
).replace(
  'from "@/lib/transcribe-error"',
  `from "${transcribeErrorUrl}"`,
);
const errorsUrl = transpileToDataUrl(errorsSource);
const errors = await import(errorsUrl);
const transcribeErrors = await import(transcribeErrorUrl);
const types = await import(
  transpileToDataUrl(
    await readFile(
      new URL("../../lib/training-transcribe/types.ts", import.meta.url),
      "utf8",
    ),
  )
);
const resultsSource = (
  await readFile(
    new URL("../../lib/training-transcribe/results.ts", import.meta.url),
    "utf8",
  )
).replace('from "./errors"', `from "${errorsUrl}"`);
const results = await import(transpileToDataUrl(resultsSource));

const {
  TranscribeBusinessError,
  TranscribeEmptyResultError,
} = transcribeErrors;

function transcript(overrides = {}) {
  const now = new Date("2026-07-18T00:00:00.000Z");

  return {
    id: "transcript-1",
    recordingId: "recording-1",
    sessionId: "session-1",
    status: "PROCESSING",
    source: "ASR_PROVIDER",
    language: "zh-CN",
    text: "",
    segmentsJson: null,
    errorMessage: null,
    startedAt: now,
    completedAt: null,
    createdAt: now,
    updatedAt: now,
    revision: 1,
    ...overrides,
  };
}

test("transcript selection keeps the route response contract", () => {
  assert.deepEqual(Object.keys(types.transcriptSelect), [
    "id",
    "recordingId",
    "sessionId",
    "status",
    "source",
    "language",
    "text",
    "segmentsJson",
    "errorMessage",
    "startedAt",
    "completedAt",
    "createdAt",
    "updatedAt",
    "revision",
  ]);
});

test("TranscribeHttpError retains its route status", () => {
  const error = new errors.TranscribeHttpError("录音不存在。", 404);

  assert.equal(error.name, "TranscribeHttpError");
  assert.equal(error.message, "录音不存在。");
  assert.equal(error.status, 404);
});

test("error summaries prefer business raw messages, redact credentials and cap length", () => {
  const businessError = new TranscribeBusinessError(
    "用户消息",
    "network sk-secret Bearer abc.def-123",
  );

  assert.equal(
    errors.getErrorSummary(businessError),
    "network [redacted] Bearer [redacted]",
  );
  assert.equal(errors.getErrorSummary(new Error("x".repeat(600))).length, 500);
  assert.equal(errors.getErrorSummary(42), "42");
});

test("retry classification gives terminal input errors precedence", () => {
  assert.equal(
    errors.isRetryableTranscribeError(
      new TranscribeEmptyResultError("结果为空", "empty orderResult"),
    ),
    false,
  );
  assert.equal(
    errors.isRetryableTranscribeError(
      new TranscribeBusinessError(
        "文件不存在",
        "audio file does not exist after timeout",
      ),
    ),
    false,
  );
  assert.equal(
    errors.isRetryableTranscribeError(new Error("ffmpeg timeout")),
    false,
  );
  assert.equal(
    errors.isRetryableTranscribeError(new Error("network timeout")),
    true,
  );
  assert.equal(
    errors.isRetryableTranscribeError(
      new TranscribeBusinessError("暂时不可用", "HTTP 503 service unavailable"),
    ),
    true,
  );
  assert.equal(errors.isRetryableTranscribeError(new Error("logic failure")), false);
});

test("retryable failure plans keep first and later retry delays", () => {
  assert.deepEqual(
    errors.buildTranscriptionFailurePlan(new Error("network timeout"), 1, 3),
    {
      retryable: true,
      businessMessage: null,
      errorSummary: "network timeout",
      willRetry: true,
      errorMessage: errors.TEMPORARY_TRANSCRIBE_ERROR_MESSAGE,
      retryDelayMs: 5_000,
    },
  );
  assert.equal(
    errors.buildTranscriptionFailurePlan(new Error("HTTP 502"), 2, 3)
      .retryDelayMs,
    30_000,
  );
});

test("terminal and business failure plans preserve their user-facing messages", () => {
  const exhausted = errors.buildTranscriptionFailurePlan(
    new Error("network timeout"),
    3,
    3,
  );
  assert.equal(exhausted.willRetry, false);
  assert.equal(
    exhausted.errorMessage,
    "转写服务多次尝试仍失败，请稍后手工重试。",
  );
  assert.equal(exhausted.retryDelayMs, 30_000);

  const business = errors.buildTranscriptionFailurePlan(
    new TranscribeBusinessError(
      "录音文件不存在，请重新录制。",
      "audio file does not exist",
    ),
    1,
    3,
  );
  assert.equal(business.retryable, false);
  assert.equal(business.businessMessage, "录音文件不存在，请重新录制。");
  assert.equal(business.errorMessage, "录音文件不存在，请重新录制。");

  const emptyMessage = errors.buildTranscriptionFailurePlan(
    new TranscribeBusinessError("", "logic failure"),
    1,
    3,
  );
  assert.equal(emptyMessage.errorMessage, "");
});

test("unacquired results prioritize completed and failed transcripts", () => {
  const completed = transcript({ status: "COMPLETED", text: " 已完成 " });
  assert.deepEqual(
    results.resultForUnacquiredJob("exhausted", completed),
    { kind: "completed", transcript: completed },
  );

  const failed = transcript({
    status: "FAILED",
    errorMessage: "转写记录失败",
  });
  assert.deepEqual(results.resultForUnacquiredJob("active", failed, "任务失败"), {
    kind: "system-failed",
    message: "任务失败",
    transcript: failed,
  });
});

test("unacquired pending results distinguish backoff from active ownership", () => {
  const pending = transcript({ status: "PENDING" });

  assert.deepEqual(results.resultForUnacquiredJob("backoff", pending), {
    kind: "pending",
    message: "转写任务正在等待自动重试。",
    transcript: pending,
  });
  assert.deepEqual(results.resultForUnacquiredJob("active", pending), {
    kind: "pending",
    message: "转写任务已由其他处理器接管。",
    transcript: pending,
  });
  assert.equal(
    results.resultForUnacquiredJob(
      "active",
      transcript({ status: "COMPLETED", text: "   " }),
    ).kind,
    "pending",
  );
});

test("an unacquired job without a transcript fails with the existing HTTP error", () => {
  assert.throws(
    () => results.resultForUnacquiredJob("missing", null),
    (error) =>
      error instanceof errors.TranscribeHttpError &&
      error.status === 500 &&
      error.message === "无法创建转写任务。",
  );
});
