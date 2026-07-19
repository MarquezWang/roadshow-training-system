import assert from "node:assert/strict";
import test from "node:test";

import {
  AI_MAX_RESERVED_TOKENS_PER_REQUEST,
  assertAIDailyBudgetSupportsMaximumRequest,
  getAIQuotaConfig,
} from "../../lib/ai-resource-config.mjs";

test("AI quota defaults can contain the maximum single-request reservation", () => {
  assert.equal(AI_MAX_RESERVED_TOKENS_PER_REQUEST, 500_000);
  assert.deepEqual(assertAIDailyBudgetSupportsMaximumRequest({}), {
    dailyTokens: 500_000,
    maxReservedTokensPerRequest: 500_000,
  });
});

test("production AI budget validation rejects a daily limit below one request", () => {
  assert.throws(
    () =>
      assertAIDailyBudgetSupportsMaximumRequest({
        AI_USER_DAILY_TOKENS: "10000",
      }),
    /AI_USER_DAILY_TOKENS.*500000/,
  );
});

test("runtime and production validation share quota parsing bounds", () => {
  assert.equal(
    getAIQuotaConfig({ AI_USER_DAILY_TOKENS: "750000" }).dailyTokens,
    750_000,
  );
  assert.throws(
    () => getAIQuotaConfig({ AI_USER_DAILY_TOKENS: "999" }),
    /AI_USER_DAILY_TOKENS/,
  );
});
