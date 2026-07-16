import { cookies } from "next/headers";
import { notFound, redirect } from "next/navigation";
import {
  authCookieName,
  isAuthEnabled,
  parseAuthCookieValue,
} from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { findActiveAuthUser } from "@/lib/auth-user.mjs";

export async function getCurrentAuthUser() {
  if (!isAuthEnabled()) {
    return null;
  }

  const cookieStore = await cookies();
  const session = await parseAuthCookieValue(
    cookieStore.get(authCookieName)?.value,
  );

  if (!session) {
    return null;
  }

  return findActiveAuthUser(prisma, session);
}

export async function requireCurrentAuthUser() {
  const user = await getCurrentAuthUser();

  if (!isAuthEnabled()) {
    return null;
  }

  if (!user) {
    redirect("/login");
  }

  return user;
}

export async function requireAdminUser() {
  const user = await requireCurrentAuthUser();

  if (!user || user.role !== "ADMIN") {
    notFound();
  }

  return user;
}

export async function getCurrentAuthUserId() {
  const user = await requireCurrentAuthUser();
  return user?.id ?? null;
}

export async function getCurrentAccessUserId() {
  const user = await requireCurrentAuthUser();

  if (!user || user.role === "ADMIN") {
    return null;
  }

  return user.id;
}

export function withOwnerFilter<T extends object>(
  where: T,
  userId: string | null,
) {
  if (!userId) {
    return where;
  }

  return {
    ...where,
    ownerId: userId,
  };
}

export function withSessionOwnerFilter<T extends object>(
  where: T,
  userId: string | null,
) {
  if (!userId) {
    return where;
  }

  return {
    ...where,
    project: {
      ownerId: userId,
    },
  };
}

export async function requireProjectOwner(projectId: string) {
  const userId = await getCurrentAccessUserId();

  const project = await prisma.project.findFirst({
    where: withOwnerFilter({ id: projectId }, userId),
    select: { id: true, ownerId: true },
  });

  if (!project) {
    notFound();
  }

  return project;
}

export async function requireSessionOwner(sessionId: string) {
  const userId = await getCurrentAccessUserId();

  const session = await prisma.trainingSession.findFirst({
    where: userId
      ? {
          id: sessionId,
          project: {
            ownerId: userId,
          },
        }
      : { id: sessionId },
    select: {
      id: true,
      projectId: true,
    },
  });

  if (!session) {
    notFound();
  }

  return session;
}

export async function requireFileOwner(fileId: string) {
  const userId = await getCurrentAccessUserId();

  const file = await prisma.fileAsset.findFirst({
    where: userId
      ? {
          id: fileId,
          project: {
            ownerId: userId,
          },
        }
      : { id: fileId },
    select: {
      id: true,
      projectId: true,
    },
  });

  if (!file) {
    notFound();
  }

  return file;
}

export async function isProjectOwnedByCurrentUser(projectId: string) {
  const userId = await getCurrentAccessUserId();

  if (!userId) {
    return true;
  }

  const count = await prisma.project.count({
    where: {
      id: projectId,
      ownerId: userId,
    },
  });

  return count > 0;
}

export async function isSessionOwnedByCurrentUser(sessionId: string) {
  const userId = await getCurrentAccessUserId();

  if (!userId) {
    return true;
  }

  const count = await prisma.trainingSession.count({
    where: {
      id: sessionId,
      project: {
        ownerId: userId,
      },
    },
  });

  return count > 0;
}
