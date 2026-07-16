import assert from "node:assert/strict";
import test from "node:test";
import { createHash } from "node:crypto";

import {
  hashPassword,
  passwordHashNeedsUpgrade,
  verifyPasswordHash,
} from "../../lib/password-hash.mjs";

test("scrypt password hashes are salted and verifiable", async () => {
  const first = await hashPassword("correct horse battery staple");
  const second = await hashPassword("correct horse battery staple");

  assert.match(first, /^scrypt\$v1\$/);
  assert.notEqual(first, second);
  assert.equal(await verifyPasswordHash("correct horse battery staple", first), true);
  assert.equal(await verifyPasswordHash("wrong password", first), false);
  assert.equal(passwordHashNeedsUpgrade(first), false);
});

test("legacy SHA-256 hashes verify but require an upgrade", async () => {
  const legacy = createHash("sha256").update("legacy-password").digest("hex");
  assert.equal(await verifyPasswordHash("legacy-password", legacy), true);
  assert.equal(await verifyPasswordHash("legacy-password", `sha256:${legacy}`), true);
  assert.equal(passwordHashNeedsUpgrade(legacy), true);
});

test("malformed password hashes fail closed", async () => {
  assert.equal(await verifyPasswordHash("password", ""), false);
  assert.equal(await verifyPasswordHash("password", "scrypt$v1$bad"), false);
  assert.equal(await verifyPasswordHash("password", "not-a-password-hash"), false);
});
