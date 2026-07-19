import { isIP } from "node:net";

export const directClientAddressBucket = "direct";
export const unresolvedProxyAddressBucket = "proxy-unresolved";

const maxTrustedProxyHops = 10;

export function parseTrustedProxyHops(value) {
  if (value === undefined || value === null || String(value).trim() === "") {
    return 0;
  }

  const normalized = String(value).trim();
  if (!/^\d+$/.test(normalized)) {
    return 0;
  }

  const hops = Number(normalized);
  return Number.isSafeInteger(hops) && hops <= maxTrustedProxyHops ? hops : 0;
}

function normalizeIpAddress(value) {
  const normalized = value.trim();
  return isIP(normalized) ? normalized.toLowerCase() : null;
}

function readForwardedAddresses(headers) {
  const forwardedFor = headers.get("x-forwarded-for");
  if (!forwardedFor) {
    return [];
  }

  return forwardedFor.split(",").map(normalizeIpAddress);
}

/**
 * Resolve a login-throttle address only through an explicitly trusted proxy
 * chain. With the secure default of zero trusted hops, all forwarded headers
 * are ignored because a direct client can forge them.
 */
export function resolveLoginClientAddress(
  headers,
  trustedProxyHopsValue = process.env.TRUSTED_PROXY_HOPS,
) {
  const trustedProxyHops = parseTrustedProxyHops(trustedProxyHopsValue);
  if (trustedProxyHops === 0) {
    return directClientAddressBucket;
  }

  const addresses = readForwardedAddresses(headers);
  const clientIndex = addresses.length - trustedProxyHops;
  if (clientIndex >= 0 && addresses[clientIndex]) {
    return addresses[clientIndex];
  }

  if (trustedProxyHops === 1 && addresses.length === 0) {
    const realIp = headers.get("x-real-ip");
    const normalizedRealIp = realIp ? normalizeIpAddress(realIp) : null;
    if (normalizedRealIp) {
      return normalizedRealIp;
    }
  }

  return unresolvedProxyAddressBucket;
}
