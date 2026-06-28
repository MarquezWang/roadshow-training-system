"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { hashPassword } from "@/lib/auth";
import { requireAdminUser } from "@/lib/auth-server";
import { prisma } from "@/lib/prisma";

const validRoles = new Set(["USER", "ADMIN", "TEAM"]);

function getText(formData: FormData, name: string) {
  return String(formData.get(name) ?? "").trim();
}

function redirectWithMessage(type: "created" | "updated" | "password" | "error") {
  revalidatePath("/admin/users");
  redirect(`/admin/users?status=${type}`);
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
    await prisma.user.update({
      where: { id },
      data: {
        name,
        role: safeRole,
      },
    });
  } catch {
    redirectWithMessage("error");
  }

  redirectWithMessage("updated");
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
      },
    });
  } catch {
    redirectWithMessage("error");
  }

  redirectWithMessage("password");
}
