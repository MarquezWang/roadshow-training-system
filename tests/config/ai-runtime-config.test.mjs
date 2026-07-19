import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  AI_RUNTIME_INTEGER_SETTINGS,
  getAIRuntimeLimits,
} from "../../lib/ai-runtime-config.mjs";

test("runtime AI limits enforce the production ranges", () => {
  assert.deepEqual(getAIRuntimeLimits({}), {
    timeoutMs: 60_000,
    maxOutputTokens: 3_000,
  });
  assert.throws(
    () =>
      getAIRuntimeLimits({
        AI_TIMEOUT_MS: "500000",
        AI_MAX_OUTPUT_TOKENS: "3000",
      }),
    /AI_TIMEOUT_MS/,
  );
  assert.throws(
    () =>
      getAIRuntimeLimits({
        AI_TIMEOUT_MS: "60000",
        AI_MAX_OUTPUT_TOKENS: "50",
      }),
    /AI_MAX_OUTPUT_TOKENS/,
  );
  assert.deepEqual(
    AI_RUNTIME_INTEGER_SETTINGS.map((setting) => setting.name),
    ["AI_TIMEOUT_MS", "AI_MAX_OUTPUT_TOKENS"],
  );
});

test("runtime and production check import the same AI config module", async () => {
  const [runtimeSource, checkSource] = await Promise.all([
    readFile(new URL("../../lib/ai.ts", import.meta.url), "utf8"),
    readFile(new URL("../../scripts/check-prod-config.mjs", import.meta.url), "utf8"),
  ]);

  assert.match(runtimeSource, /getAIRuntimeLimits/);
  assert.match(checkSource, /readBoundedIntegerSetting/);
  assert.match(checkSource, /AI_RUNTIME_INTEGER_SETTINGS/);
});
