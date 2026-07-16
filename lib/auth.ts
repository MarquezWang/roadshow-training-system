import type { NextRequest } from "next/server";
import { assertProductionAuthEnabled } from "@/lib/production-auth-guard.mjs";
import {
  createSignedAuthCookieValue,
  parseSignedAuthCookieValue,
} from "@/lib/auth-cookie.mjs";

export const authCookieName = "roadshow_auth";
export const authSessionMaxAgeSec = 60 * 60 * 24 * 7;

export type SessionPayload = {
  userId: string;
  username: string;
  sessionVersion: number;
  exp: number;
};

function getAuthSecrets() {
  assertProductionAuthEnabled(process.env);
  return {
    currentSecret:
      process.env.AUTH_SECRET?.trim() || "roadshow-dev-auth-secret",
    previousSecret: process.env.AUTH_SECRET_PREVIOUS?.trim() || undefined,
  };
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

export async function createAuthCookieValue(
  userId: string,
  username: string,
  sessionVersion = 0,
) {
  const payload: SessionPayload = {
    userId,
    username,
    sessionVersion,
    exp: Math.floor(Date.now() / 1000) + authSessionMaxAgeSec,
  };
  return createSignedAuthCookieValue(payload, getAuthSecrets().currentSecret);
}

export async function verifyAuthCookieValue(value: string | undefined) {
  return Boolean(await parseAuthCookieValue(value));
}

export async function parseAuthCookieValue(value: string | undefined) {
  return (await parseAuthCookieValueWithMetadata(value))?.session ?? null;
}

export async function parseAuthCookieValueWithMetadata(
  value: string | undefined,
) {
  const secrets = getAuthSecrets();
  const result = await parseSignedAuthCookieValue(value, secrets);
  if (!result) {
    return null;
  }

  const session = result.payload as SessionPayload;
  return {
    session,
    rotatedCookieValue:
      result.verifiedWith === "previous"
        ? await createSignedAuthCookieValue(session, secrets.currentSecret)
        : null,
  };
}

export async function getAuthenticatedRequest(request: NextRequest) {
  if (!isAuthEnabled()) {
    return null;
  }

  return parseAuthCookieValueWithMetadata(
    request.cookies.get(authCookieName)?.value,
  );
}

export async function isAuthenticatedRequest(request: NextRequest) {
  if (!isAuthEnabled()) {
    return true;
  }

  return Boolean(await getAuthenticatedRequest(request));
}
