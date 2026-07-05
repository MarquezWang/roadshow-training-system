import assert from "node:assert/strict";
import test from "node:test";

import { assertProductionAuthEnabled } from "../../lib/production-auth-guard.mjs";

test("production auth guard blocks production without AUTH_ENABLED=true", () => {
  assert.throws(
    () =>
      assertProductionAuthEnabled({
        NODE_ENV: "production",
        AUTH_ENABLED: "false",
      }),
    /AUTH_ENABLED must be true/,
  );
});

test("production auth guard allows production when AUTH_ENABLED=true", () => {
  assert.doesNotThrow(() =>
    assertProductionAuthEnabled({
      NODE_ENV: "production",
      AUTH_ENABLED: "true",
    }),
  );
});

test("production auth guard does not force auth outside production", () => {
  assert.doesNotThrow(() =>
    assertProductionAuthEnabled({
      NODE_ENV: "development",
      AUTH_ENABLED: "false",
    }),
  );
});
