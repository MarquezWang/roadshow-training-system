import assert from "node:assert/strict";
import test from "node:test";

import { getSafeInternalPath } from "../../lib/safe-redirect.mjs";

test("safe redirect accepts normalized internal paths", () => {
  assert.equal(getSafeInternalPath("/projects/abc?tab=files"), "/projects/abc?tab=files");
});

test("safe redirect rejects external and ambiguous paths", () => {
  for (const value of [
    "https://evil.example/",
    "//evil.example/",
    "/\\evil.example/",
    "/%5cevil.example/",
    "/%255cevil.example/",
    "/login?next=/projects",
    "/logout",
  ]) {
    assert.equal(getSafeInternalPath(value), "/projects", value);
  }
});
