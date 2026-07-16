import assert from "node:assert/strict";
import test from "node:test";

import {
  createSignedAuthCookieValue,
  parseSignedAuthCookieValue,
} from "../../lib/auth-cookie.mjs";

const currentSecret = "current-auth-secret-with-at-least-32-characters";
const previousSecret = "previous-auth-secret-with-at-least-32-characters";

function payload() {
  return {
    userId: "user-1",
    username: "user@example.test",
    sessionVersion: 3,
    exp: Math.floor(Date.now() / 1000) + 300,
  };
}

test("current secret cookies verify without rotation", async () => {
  const value = await createSignedAuthCookieValue(payload(), currentSecret);
  const parsed = await parseSignedAuthCookieValue(value, {
    currentSecret,
    previousSecret,
  });

  assert.equal(parsed?.verifiedWith, "current");
  assert.equal(parsed?.payload.userId, "user-1");
});

test("previous secret cookies verify and can be re-signed by the current secret", async () => {
  const oldValue = await createSignedAuthCookieValue(payload(), previousSecret);
  const parsed = await parseSignedAuthCookieValue(oldValue, {
    currentSecret,
    previousSecret,
  });

  assert.equal(parsed?.verifiedWith, "previous");
  assert.ok(parsed?.payload);

  const rotatedValue = await createSignedAuthCookieValue(
    parsed.payload,
    currentSecret,
  );
  const rotated = await parseSignedAuthCookieValue(rotatedValue, {
    currentSecret,
  });
  assert.equal(rotated?.verifiedWith, "current");
  assert.deepEqual(rotated?.payload, parsed.payload);
});

test("previous secret is not used for signing or accepted when unconfigured", async () => {
  const oldValue = await createSignedAuthCookieValue(payload(), previousSecret);
  assert.equal(
    await parseSignedAuthCookieValue(oldValue, { currentSecret }),
    null,
  );
});

test("expired and malformed cookies fail closed", async () => {
  const expired = await createSignedAuthCookieValue(
    { ...payload(), exp: Math.floor(Date.now() / 1000) - 1 },
    currentSecret,
  );
  assert.equal(
    await parseSignedAuthCookieValue(expired, { currentSecret }),
    null,
  );
  assert.equal(
    await parseSignedAuthCookieValue("not-a-cookie", { currentSecret }),
    null,
  );
});
