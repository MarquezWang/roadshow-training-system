import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

function read(path) {
  return readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");
}

test("proxy protects project onboarding and admin api namespaces", () => {
  const source = read("proxy.ts");

  assert.match(
    source,
    /pathname\.startsWith\("\/api\/projects\/"\)/,
    "proxy must protect all /api/projects/* routes, not only individual onboarding endpoints",
  );
  assert.match(
    source,
    /pathname\.startsWith\("\/api\/admin\/"\)/,
    "proxy must protect all /api/admin/* routes",
  );
  assert.match(
    source,
    /"\/api\/projects\/:path\*"/,
    "Next proxy matcher must include /api/projects/:path*",
  );
  assert.match(
    source,
    /"\/api\/admin\/:path\*"/,
    "Next proxy matcher must include /api/admin/:path*",
  );
});

test("ai connectivity endpoint remains admin-only in production", () => {
  const source = read("app/api/ai/test/route.ts");

  assert.match(
    source,
    /process\.env\.NODE_ENV === "production"/,
    "/api/ai/test must distinguish production from development diagnostics",
  );
  assert.match(
    source,
    /getCurrentAuthUser\(\)/,
    "/api/ai/test must check the current authenticated user",
  );
  assert.match(
    source,
    /user\.role !== "ADMIN"/,
    "/api/ai/test must reject non-admin users in production",
  );
  assert.match(
    source,
    /status:\s*404/,
    "/api/ai/test must hide itself from non-admin production callers",
  );
});

test("proxy rotates previous-secret cookies and leaves database validation to login", () => {
  const proxySource = read("proxy.ts");
  const loginSource = read("app/login/page.tsx");

  assert.match(proxySource, /getAuthenticatedRequest\(request\)/);
  assert.match(proxySource, /authResult\.rotatedCookieValue/);
  assert.match(proxySource, /response\.cookies\.set\(authCookieName/);
  assert.match(loginSource, /getCurrentAuthUser\(\)/);
});

test("large recording uploads bypass proxy buffering but keep route ownership checks", () => {
  const proxySource = read("proxy.ts");
  const recordingRouteSource = read(
    "app/training/[sessionId]/recordings/route.ts",
  );

  assert.match(
    proxySource,
    /\/training\/\(\(\?!\[\^\/\]\+\/recordings\/\?\$\)\.\*\)/,
  );
  assert.match(
    recordingRouteSource,
    /isSessionOwnedByCurrentUser\(sessionId\)/,
    "recording upload route must authorize requests without relying on Proxy",
  );
});
