import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";
import { getUtcDailyQuotaWindow } from "../../lib/ai-quota-window.mjs";

const errorStub = `
export class AIResourceLimitError extends Error {
  constructor(message, retryAfterSec, code) {
    super(message);
    this.retryAfterSec = retryAfterSec;
    this.code = code;
    this.retryable = ![
      "AI_REQUEST_EXCEEDS_DAILY_BUDGET",
      "AI_REQUEST_TOO_LARGE",
    ].includes(code);
  }
}`;
const errorStubUrl = `data:text/javascript;base64,${Buffer.from(errorStub).toString("base64")}`;
const source = (
  await readFile(
    new URL("../../lib/ai-http-response.ts", import.meta.url),
    "utf8",
  )
).replace('from "@/lib/ai-resource-guard"', `from "${errorStubUrl}"`);
const output = ts.transpileModule(source, {
  compilerOptions: {
    module: ts.ModuleKind.ESNext,
    target: ts.ScriptTarget.ES2022,
  },
}).outputText;
const helper = await import(
  `data:text/javascript;base64,${Buffer.from(output).toString("base64")}`
);
const { AIResourceLimitError } = await import(errorStubUrl);

test("AI resource errors use a stable 429 response contract", async () => {
  const response = helper.createAIResourceLimitResponse(
    new AIResourceLimitError(
      "今日 AI Token 预算已用尽。",
      3600,
      "AI_DAILY_BUDGET_EXHAUSTED",
    ),
  );

  assert.equal(response.status, 429);
  assert.equal(response.headers.get("Retry-After"), "3600");
  assert.deepEqual(await response.json(), {
    status: "failed",
    error: "今日 AI Token 预算已用尽。",
    message: "今日 AI Token 预算已用尽。",
    code: "AI_DAILY_BUDGET_EXHAUSTED",
    retryAfterSec: 3600,
    retryable: true,
  });
  assert.equal(helper.createAIResourceLimitResponse(new Error("boom")), null);
});

test("a request larger than its entire daily budget is terminal", async () => {
  const response = helper.createAIResourceLimitResponse(
    new AIResourceLimitError(
      "单次 AI 请求超过每日预算。",
      0,
      "AI_REQUEST_EXCEEDS_DAILY_BUDGET",
    ),
  );

  assert.equal(response.status, 422);
  assert.equal(response.headers.get("Retry-After"), null);
  assert.deepEqual(await response.json(), {
    status: "failed",
    error: "单次 AI 请求超过每日预算。",
    message: "单次 AI 请求超过每日预算。",
    code: "AI_REQUEST_EXCEEDS_DAILY_BUDGET",
    retryAfterSec: 0,
    retryable: false,
  });
});

test("daily AI quota retry delay reaches the next UTC boundary", () => {
  assert.deepEqual(
    getUtcDailyQuotaWindow(new Date("2026-07-19T00:00:00.000Z")),
    {
      dayKey: "2026-07-19",
      retryAfterSec: 24 * 60 * 60,
    },
  );
  assert.deepEqual(
    getUtcDailyQuotaWindow(new Date("2026-07-19T12:00:00.000Z")),
    {
      dayKey: "2026-07-19",
      retryAfterSec: 12 * 60 * 60,
    },
  );
  assert.equal(
    getUtcDailyQuotaWindow(
      new Date("2026-07-19T23:59:59.250Z"),
    ).retryAfterSec,
    1,
  );
});

test("daily budget errors use the shared UTC quota window", async () => {
  const guardSource = await readFile(
    new URL("../../lib/ai-resource-guard.ts", import.meta.url),
    "utf8",
  );

  assert.match(
    guardSource,
    /const \{ dayKey, retryAfterSec \} = getUtcDailyQuotaWindow\(\)/,
  );
  assert.equal(
    guardSource.match(
      /retryAfterSec,\s*"AI_DAILY_BUDGET_EXHAUSTED"/g,
    )?.length,
    2,
  );
  assert.doesNotMatch(guardSource, /60 \* 60/);
});

test("an intrinsically oversized request fails before daily usage lookup", async () => {
  const guardSource = await readFile(
    new URL("../../lib/ai-resource-guard.ts", import.meta.url),
    "utf8",
  );
  const requestCheckIndex = guardSource.indexOf(
    "reservedTokens > dailyTokens",
  );
  const transactionIndex = guardSource.indexOf("prisma.$transaction");
  const feasibilityCheckIndex = guardSource.indexOf(
    "assertRequestReservationFitsBudget(",
    requestCheckIndex + 1,
  );
  const providerCheckIndex = guardSource.indexOf(
    "state.providerBackoffUntil > now",
  );

  assert.ok(requestCheckIndex >= 0);
  assert.ok(transactionIndex > requestCheckIndex);
  assert.ok(feasibilityCheckIndex > requestCheckIndex);
  assert.ok(providerCheckIndex > feasibilityCheckIndex);
  assert.match(guardSource, /AI_REQUEST_EXCEEDS_DAILY_BUDGET/);
  assert.match(guardSource, /AI_REQUEST_TOO_LARGE/);
});

test("HTTP AI entry points use the shared 429 response helper", async () => {
  const routePaths = [
    "../../app/api/ai/test/route.ts",
    "../../app/api/projects/[id]/material-diagnosis/route.ts",
    "../../app/api/projects/profile-recognition/route.ts",
    "../../app/projects/[id]/questions/generate/route.ts",
    "../../app/projects/[id]/scoring/route.ts",
    "../../app/training/[sessionId]/analysis/route.ts",
    "../../app/training/[sessionId]/qa/questions/generate/route.ts",
    "../../app/training/[sessionId]/qa/questions/dynamic-followup/route.ts",
  ];
  const sources = await Promise.all(
    routePaths.map((routePath) =>
      readFile(new URL(routePath, import.meta.url), "utf8"),
    ),
  );

  for (const [index, routeSource] of sources.entries()) {
    assert.match(
      routeSource,
      /createAIResourceLimitResponse\(error\)/,
      routePaths[index],
    );
  }
});
