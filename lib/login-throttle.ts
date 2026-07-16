import { createHash } from "node:crypto";
import { prisma } from "@/lib/prisma";

const ATTEMPT_LIMIT = 5;
const WINDOW_MS = 15 * 60_000;
const LOCK_MS = 15 * 60_000;

function buildThrottleKey(username: string, clientAddress: string) {
  return createHash("sha256")
    .update(`${username.trim().toLowerCase()}\n${clientAddress.trim() || "unknown"}`)
    .digest("hex");
}

export async function getLoginLock(
  username: string,
  clientAddress: string,
  now = new Date(),
) {
  const key = buildThrottleKey(username, clientAddress);
  const throttle = await prisma.loginThrottle.findUnique({ where: { key } });

  if (!throttle) {
    return null;
  }

  if (throttle.lockedUntil && throttle.lockedUntil > now) {
    return throttle.lockedUntil;
  }

  if (now.getTime() - throttle.windowStartedAt.getTime() > WINDOW_MS) {
    await prisma.loginThrottle.deleteMany({ where: { key } });
  }

  return null;
}

export async function recordFailedLogin(
  username: string,
  clientAddress: string,
  now = new Date(),
) {
  const key = buildThrottleKey(username, clientAddress);

  return prisma.$transaction(async (transaction) => {
    const existing = await transaction.loginThrottle.findUnique({
      where: { key },
    });
    const windowExpired =
      !existing || now.getTime() - existing.windowStartedAt.getTime() > WINDOW_MS;
    const failedCount = windowExpired ? 1 : existing.failedCount + 1;
    const lockedUntil =
      failedCount >= ATTEMPT_LIMIT ? new Date(now.getTime() + LOCK_MS) : null;

    await transaction.loginThrottle.upsert({
      where: { key },
      create: {
        key,
        failedCount,
        windowStartedAt: now,
        lockedUntil,
      },
      update: {
        failedCount,
        windowStartedAt: windowExpired ? now : existing!.windowStartedAt,
        lockedUntil,
      },
    });

    return lockedUntil;
  });
}

export async function clearFailedLogins(
  username: string,
  clientAddress: string,
) {
  await prisma.loginThrottle.deleteMany({
    where: { key: buildThrottleKey(username, clientAddress) },
  });
}
