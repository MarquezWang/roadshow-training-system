import assert from "node:assert/strict";
import test from "node:test";

import {
  directClientAddressBucket,
  parseTrustedProxyHops,
  resolveLoginClientAddress,
  unresolvedProxyAddressBucket,
} from "../../lib/client-address.mjs";

test("forwarded headers are ignored unless a proxy hop is explicitly trusted", () => {
  const headers = new Headers({
    "x-forwarded-for": "198.51.100.44",
    "x-real-ip": "198.51.100.45",
  });

  assert.equal(resolveLoginClientAddress(headers), directClientAddressBucket);
  assert.equal(
    resolveLoginClientAddress(headers, "invalid"),
    directClientAddressBucket,
  );
});

test("one trusted proxy uses the rightmost forwarded address", () => {
  const headers = new Headers({
    "x-forwarded-for": "203.0.113.250, 198.51.100.12",
  });

  assert.equal(resolveLoginClientAddress(headers, "1"), "198.51.100.12");
});

test("multiple trusted proxies select the address before their hop chain", () => {
  const headers = new Headers({
    "x-forwarded-for": "203.0.113.8, 192.0.2.20, 192.0.2.21",
  });

  assert.equal(resolveLoginClientAddress(headers, "2"), "192.0.2.20");
});

test("invalid or incomplete proxy data fails into a shared throttle bucket", () => {
  assert.equal(
    resolveLoginClientAddress(
      new Headers({ "x-forwarded-for": "not-an-ip" }),
      "1",
    ),
    unresolvedProxyAddressBucket,
  );
  assert.equal(
    resolveLoginClientAddress(
      new Headers({ "x-forwarded-for": "198.51.100.12" }),
      "2",
    ),
    unresolvedProxyAddressBucket,
  );
});

test("a single trusted proxy may supply a validated x-real-ip fallback", () => {
  assert.equal(
    resolveLoginClientAddress(
      new Headers({ "x-real-ip": "2001:db8::7" }),
      "1",
    ),
    "2001:db8::7",
  );
});

test("trusted proxy hop parsing is bounded and fail-closed", () => {
  assert.equal(parseTrustedProxyHops(undefined), 0);
  assert.equal(parseTrustedProxyHops("0"), 0);
  assert.equal(parseTrustedProxyHops("10"), 10);
  assert.equal(parseTrustedProxyHops("11"), 0);
  assert.equal(parseTrustedProxyHops("1.5"), 0);
});
