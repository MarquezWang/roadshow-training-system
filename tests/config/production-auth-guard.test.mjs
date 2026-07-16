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

test("production auth guard rejects production without an independent AUTH_SECRET", () => {
  assert.throws(
    () =>
      assertProductionAuthEnabled({
        NODE_ENV: "production",
        AUTH_ENABLED: "true",
      }),
    /AUTH_SECRET must be an independent random secret/,
  );
});

test("production auth guard rejects weak or known development secrets", () => {
  for (const AUTH_SECRET of [
    "short-secret",
    "roadshow-dev-auth-secret",
    "local-dev-auth-secret-please-change",
  ]) {
    assert.throws(
      () =>
        assertProductionAuthEnabled({
          NODE_ENV: "production",
          AUTH_ENABLED: "true",
          AUTH_SECRET,
        }),
      /AUTH_SECRET must be an independent random secret/,
    );
  }
});

test("production auth guard allows production with strong independent auth", () => {
  assert.doesNotThrow(() =>
    assertProductionAuthEnabled({
      NODE_ENV: "production",
      AUTH_ENABLED: "true",
      AUTH_SECRET: "a-strong-independent-auth-secret-1234567890",
    }),
  );
});

test("production auth guard validates an optional previous secret", () => {
  const base = {
    NODE_ENV: "production",
    AUTH_ENABLED: "true",
    AUTH_SECRET: "a-strong-independent-auth-secret-1234567890",
  };

  for (const AUTH_SECRET_PREVIOUS of [
    "short-secret",
    "roadshow-dev-auth-secret",
    base.AUTH_SECRET,
  ]) {
    assert.throws(
      () => assertProductionAuthEnabled({ ...base, AUTH_SECRET_PREVIOUS }),
      /AUTH_SECRET_PREVIOUS/,
    );
  }

  assert.doesNotThrow(() =>
    assertProductionAuthEnabled({
      ...base,
      AUTH_SECRET_PREVIOUS:
        "the-previous-independent-auth-secret-1234567890",
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
