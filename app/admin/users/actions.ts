"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireAdminUser } from "@/lib/auth-server";
import { hashPassword } from "@/lib/password";
import { prisma } from "@/lib/prisma";
import {
  changeManagedUserRole,
  setManagedUserDisabled,
} from "@/lib/admin-user-account.mjs";

const validRoles = new Set(["USER", "ADMIN", "TEAM"]);

function getText(formData: FormData, name: string) {
  return String(formData.get(name) ?? "").trim();
}

type UserActionStatus =
  | "created"
  | "updated"
  | "password"
  | "disabled"
  | "restored"
  | "cannot_self"
  | "last_admin"
  | "error";

function redirectWithMessage(type: UserActionStatus) {
  revalidatePath("/admin/users");
  redirect(`/admin/users?status=${type}`);
}

function managedUserErrorStatus(error: unknown): UserActionStatus {
  const code =
    typeof error === "object" && error && "code" in error
      ? String(error.code)
      : error instanceof Error
        ? error.message
        : "";

  if (code === "cannot_disable_self" || code === "cannot_demote_self") {
    return "cannot_self";
  }
  if (code === "last_active_admin") {
    return "last_admin";
  }
  return "error";
}

function normalizeRole(value: string) {
  const role = value.trim().toUpperCase();
  return validRoles.has(role) ? role : "USER";
}

export async function createUserAction(formData: FormData) {
  await requireAdminUser();

  const email = getText(formData, "email");
  const name = getText(formData, "name") || email;
  const password = String(formData.get("password") ?? "");
  const role = normalizeRole(getText(formData, "role"));

  if (!email || password.length < 8) {
    redirectWithMessage("error");
  }

  try {
    await prisma.user.create({
      data: {
        email,
        name,
        role,
        passwordHash: await hashPassword(password),
      },
    });
  } catch {
    redirectWithMessage("error");
  }

  redirectWithMessage("created");
}

export async function updateUserAction(formData: FormData) {
  const currentUser = await requireAdminUser();

  const id = getText(formData, "id");
  const name = getText(formData, "name");
  const role = normalizeRole(getText(formData, "role"));

  if (!id || !name) {
    redirectWithMessage("error");
  }

  const safeRole = id === currentUser.id ? "ADMIN" : role;

  try {
    await changeManagedUserRole(prisma, {
      actorId: currentUser.id,
      targetId: id,
      name,
      role: safeRole,
    });
  } catch (error) {
    redirectWithMessage(managedUserErrorStatus(error));
  }

  redirectWithMessage("updated");
}

export async function setUserDisabledAction(formData: FormData) {
  const currentUser = await requireAdminUser();
  const id = getText(formData, "id");
  const disabled = getText(formData, "disabled") === "true";

  if (!id) {
    redirectWithMessage("error");
  }

  try {
    await setManagedUserDisabled(prisma, {
      actorId: currentUser.id,
      targetId: id,
      disabled,
    });
  } catch (error) {
    redirectWithMessage(managedUserErrorStatus(error));
  }

  redirectWithMessage(disabled ? "disabled" : "restored");
}

export async function resetUserPasswordAction(formData: FormData) {
  await requireAdminUser();

  const id = getText(formData, "id");
  const password = String(formData.get("password") ?? "");

  if (!id || password.length < 8) {
    redirectWithMessage("error");
  }

  try {
    await prisma.user.update({
      where: { id },
      data: {
        passwordHash: await hashPassword(password),
        sessionVersion: { increment: 1 },
      },
    });
  } catch {
    redirectWithMessage("error");
  }

  redirectWithMessage("password");
}
