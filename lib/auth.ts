import type { NextRequest } from "next/server";

export const authCookieName = "roadshow_auth";
export const authSessionMaxAgeSec = 60 * 60 * 24 * 7;

type SessionPayload = {
  userId: string;
  username: string;
  exp: number;
};

function bytesToBase64Url(bytes: Uint8Array) {
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }

  return btoa(binary)
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replaceAll("=", "");
}

function base64UrlToBytes(value: string) {
  const padded = value
    .replaceAll("-", "+")
    .replaceAll("_", "/")
    .padEnd(Math.ceil(value.length / 4) * 4, "=");
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);

  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }

  return bytes;
}

function encodeText(value: string) {
  return new TextEncoder().encode(value);
}

function decodeText(bytes: Uint8Array) {
  return new TextDecoder().decode(bytes);
}

function getAuthSecret() {
  return (
    process.env.AUTH_SECRET?.trim() ||
    process.env.ADMIN_PASSWORD_HASH?.trim() ||
    process.env.AI_API_KEY?.trim() ||
    "roadshow-dev-auth-secret"
  );
}

export function isAuthEnabled() {
  return process.env.AUTH_ENABLED === "true";
}

export function getLoginConfigError() {
  if (!isAuthEnabled()) {
    return null;
  }

  if (!process.env.ADMIN_USERNAME?.trim()) {
    return "missing_admin_username";
  }

  if (!process.env.ADMIN_PASSWORD_HASH?.trim()) {
    return "missing_admin_password_hash";
  }

  return null;
}

async function sha256Hex(value: string) {
  const digest = await crypto.subtle.digest("SHA-256", encodeText(value));

  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

export async function hashPassword(password: string) {
  return sha256Hex(password);
}

async function hmacSha256(value: string) {
  const key = await crypto.subtle.importKey(
    "raw",
    encodeText(getAuthSecret()),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign("HMAC", key, encodeText(value));

  return bytesToBase64Url(new Uint8Array(signature));
}

function normalizePasswordHash(value: string | undefined) {
  return value?.trim().replace(/^sha256:/i, "").toLowerCase() ?? "";
}

function safeEqual(first: string, second: string) {
  if (first.length !== second.length) {
    return false;
  }

  let diff = 0;
  for (let index = 0; index < first.length; index += 1) {
    diff |= first.charCodeAt(index) ^ second.charCodeAt(index);
  }

  return diff === 0;
}

export async function verifyAdminCredentials(username: string, password: string) {
  const expectedUsername = process.env.ADMIN_USERNAME?.trim() ?? "";
  const expectedPasswordHash = normalizePasswordHash(
    process.env.ADMIN_PASSWORD_HASH,
  );

  if (!expectedUsername || !expectedPasswordHash) {
    return false;
  }

  const passwordHash = await hashPassword(password);

  return (
    username.trim() === expectedUsername &&
    safeEqual(passwordHash, expectedPasswordHash)
  );
}

export async function verifyPasswordHash(password: string, expectedHash: string) {
  const normalizedHash = normalizePasswordHash(expectedHash);
  if (!normalizedHash) {
    return false;
  }

  return safeEqual(await hashPassword(password), normalizedHash);
}

export async function createAuthCookieValue(userId: string, username: string) {
  const payload: SessionPayload = {
    userId,
    username,
    exp: Math.floor(Date.now() / 1000) + authSessionMaxAgeSec,
  };
  const payloadValue = bytesToBase64Url(encodeText(JSON.stringify(payload)));
  const signature = await hmacSha256(payloadValue);

  return `${payloadValue}.${signature}`;
}

export async function verifyAuthCookieValue(value: string | undefined) {
  return Boolean(await parseAuthCookieValue(value));
}

export async function parseAuthCookieValue(value: string | undefined) {
  if (!value) {
    return null;
  }

  const [payloadValue, signature] = value.split(".");
  if (!payloadValue || !signature) {
    return null;
  }

  const expectedSignature = await hmacSha256(payloadValue);
  if (!safeEqual(signature, expectedSignature)) {
    return null;
  }

  try {
    const payload = JSON.parse(
      decodeText(base64UrlToBytes(payloadValue)),
    ) as Partial<SessionPayload>;

    if (
      typeof payload.userId === "string" &&
      typeof payload.username === "string" &&
      typeof payload.exp === "number" &&
      payload.exp > Math.floor(Date.now() / 1000)
    ) {
      return payload as SessionPayload;
    }

    return null;
  } catch {
    return null;
  }
}

export async function isAuthenticatedRequest(request: NextRequest) {
  if (!isAuthEnabled()) {
    return true;
  }

  return verifyAuthCookieValue(request.cookies.get(authCookieName)?.value);
}
