"use server";

import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import {
  authCookieName,
  authSessionMaxAgeSec,
  createAuthCookieValue,
  getLoginConfigError,
  isAuthEnabled,
} from "@/lib/auth";
import {
  hashPassword,
  passwordHashNeedsUpgrade,
  verifyAdminCredentials,
  verifyPasswordHash,
} from "@/lib/password";
import { prisma } from "@/lib/prisma";
import { getSafeInternalPath } from "@/lib/safe-redirect.mjs";
import {
  clearFailedLogins,
  getLoginLock,
  recordFailedLogin,
} from "@/lib/login-throttle";

export async function loginAction(formData: FormData) {
  const next = getSafeInternalPath(formData.get("next"));

  if (!isAuthEnabled()) {
    redirect(next);
  }

  const hasPasswordUser =
    (await prisma.user.count({
      where: {
        passwordHash: {
          not: null,
        },
      },
    })) > 0;
  const configError = hasPasswordUser ? null : getLoginConfigError();
  if (configError) {
    redirect(`/login?error=config&next=${encodeURIComponent(next)}`);
  }

  const username = String(formData.get("username") ?? "").trim();
  const password = String(formData.get("password") ?? "");
  const requestHeaders = await headers();
  const clientAddress =
    requestHeaders.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    requestHeaders.get("x-real-ip")?.trim() ||
    "unknown";
  const lockedUntil = await getLoginLock(username, clientAddress);
  if (lockedUntil) {
    redirect(`/login?error=rate_limited&next=${encodeURIComponent(next)}`);
  }
  let user = await prisma.user.findUnique({
    where: {
      email: username,
    },
    select: {
      id: true,
      email: true,
      passwordHash: true,
      sessionVersion: true,
      disabledAt: true,
    },
  });

  const isBootstrapAdmin = await verifyAdminCredentials(username, password);

  if (!user && isBootstrapAdmin) {
    user = await prisma.user.create({
      data: {
        email: username,
        name: username,
        role: "ADMIN",
        passwordHash: await hashPassword(password),
      },
      select: {
        id: true,
        email: true,
        passwordHash: true,
        sessionVersion: true,
        disabledAt: true,
      },
    });
  }

  if (user && !user.disabledAt && !user.passwordHash && isBootstrapAdmin) {
    user = await prisma.user.update({
      where: {
        id: user.id,
      },
      data: {
        passwordHash: await hashPassword(password),
      },
      select: {
        id: true,
        email: true,
        passwordHash: true,
        sessionVersion: true,
        disabledAt: true,
      },
    });
  }

  const isValid =
    Boolean(user?.passwordHash) &&
    !user?.disabledAt &&
    (await verifyPasswordHash(password, user!.passwordHash!));

  if (!isValid) {
    const nextLock = await recordFailedLogin(username, clientAddress);
    if (nextLock) {
      redirect(`/login?error=rate_limited&next=${encodeURIComponent(next)}`);
    }
    redirect(`/login?error=invalid&next=${encodeURIComponent(next)}`);
  }

  await clearFailedLogins(username, clientAddress);

  if (passwordHashNeedsUpgrade(user!.passwordHash!)) {
    user = await prisma.user.update({
      where: { id: user!.id },
      data: { passwordHash: await hashPassword(password) },
      select: {
        id: true,
        email: true,
        passwordHash: true,
        sessionVersion: true,
        disabledAt: true,
      },
    });
  }

  const cookieStore = await cookies();
  cookieStore.set(
    authCookieName,
    await createAuthCookieValue(user!.id, username, user!.sessionVersion),
    {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/",
      maxAge: authSessionMaxAgeSec,
    },
  );

  redirect(next);
}
