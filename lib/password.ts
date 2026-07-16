import {
  hashPassword as hashPasswordImpl,
  passwordHashNeedsUpgrade as passwordHashNeedsUpgradeImpl,
  verifyPasswordHash as verifyPasswordHashImpl,
} from "@/lib/password-hash.mjs";

export async function hashPassword(password: string) {
  return hashPasswordImpl(password) as Promise<string>;
}

export function passwordHashNeedsUpgrade(value: string) {
  return passwordHashNeedsUpgradeImpl(value) as boolean;
}

export async function verifyPasswordHash(password: string, expectedHash: string) {
  return verifyPasswordHashImpl(password, expectedHash) as Promise<boolean>;
}

export async function verifyAdminCredentials(username: string, password: string) {
  const expectedUsername = process.env.ADMIN_USERNAME?.trim() ?? "";
  const expectedPasswordHash = process.env.ADMIN_PASSWORD_HASH?.trim() ?? "";

  if (!expectedUsername || !expectedPasswordHash) {
    return false;
  }

  return (
    username.trim() === expectedUsername &&
    (await verifyPasswordHash(password, expectedPasswordHash))
  );
}
