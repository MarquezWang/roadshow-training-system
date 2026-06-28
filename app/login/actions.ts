"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import {
  authCookieName,
  authSessionMaxAgeSec,
  createAuthCookieValue,
  getLoginConfigError,
  isAuthEnabled,
  verifyAdminCredentials,
  verifyPasswordHash,
} from "@/lib/auth";
import { prisma } from "@/lib/prisma";

function getSafeNext(value: FormDataEntryValue | null) {
  const next = String(value ?? "/projects").trim();

  if (!next.startsWith("/") || next.startsWith("//")) {
    return "/projects";
  }

  if (next.startsWith("/login") || next.startsWith("/logout")) {
    return "/projects";
  }

  return next;
}

export async function loginAction(formData: FormData) {
  const next = getSafeNext(formData.get("next"));

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
  let user = await prisma.user.findUnique({
    where: {
      email: username,
    },
    select: {
      id: true,
      email: true,
      passwordHash: true,
    },
  });

  const isBootstrapAdmin = await verifyAdminCredentials(username, password);

  if (!user && isBootstrapAdmin) {
    user = await prisma.user.create({
      data: {
        email: username,
        name: username,
        role: "ADMIN",
        passwordHash: process.env.ADMIN_PASSWORD_HASH?.trim(),
      },
      select: {
        id: true,
        email: true,
        passwordHash: true,
      },
    });
  }

  if (user && !user.passwordHash && isBootstrapAdmin) {
    user = await prisma.user.update({
      where: {
        id: user.id,
      },
      data: {
        passwordHash: process.env.ADMIN_PASSWORD_HASH?.trim(),
      },
      select: {
        id: true,
        email: true,
        passwordHash: true,
      },
    });
  }

  const isValid =
    Boolean(user?.passwordHash) &&
    (await verifyPasswordHash(password, user!.passwordHash!));

  if (!isValid) {
    redirect(`/login?error=invalid&next=${encodeURIComponent(next)}`);
  }

  const cookieStore = await cookies();
  cookieStore.set(authCookieName, await createAuthCookieValue(user!.id, username), {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: authSessionMaxAgeSec,
  });

  redirect(next);
}
