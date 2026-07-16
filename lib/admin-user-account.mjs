export class ManagedUserError extends Error {
  constructor(code) {
    super(code);
    this.name = "ManagedUserError";
    this.code = code;
  }
}

async function withSerializedAdminWrite(prisma, actorId, operation) {
  return prisma.$transaction(
    async (tx) => {
      const locked = await tx.$executeRawUnsafe(
        'UPDATE "User" SET "sessionVersion" = "sessionVersion" WHERE "id" = ?',
        actorId,
      );
      if (locked !== 1) {
        throw new ManagedUserError("actor_not_active_admin");
      }

      const actor = await tx.user.findUnique({
        where: { id: actorId },
        select: { role: true, disabledAt: true },
      });
      if (!actor || actor.role !== "ADMIN" || actor.disabledAt) {
        throw new ManagedUserError("actor_not_active_admin");
      }

      return operation(tx);
    },
    { maxWait: 10_000, timeout: 10_000 },
  );
}

async function assertAdminCanBeRemoved(tx, target) {
  if (target.role !== "ADMIN" || target.disabledAt) {
    return;
  }

  const activeAdminCount = await tx.user.count({
    where: { role: "ADMIN", disabledAt: null },
  });
  if (activeAdminCount <= 1) {
    throw new ManagedUserError("last_active_admin");
  }
}

export async function changeManagedUserRole(
  prisma,
  { actorId, targetId, name, role },
) {
  return withSerializedAdminWrite(prisma, actorId, async (tx) => {
    const target = await tx.user.findUnique({
      where: { id: targetId },
      select: { id: true, role: true, disabledAt: true },
    });
    if (!target) {
      throw new ManagedUserError("user_not_found");
    }
    if (targetId === actorId && role !== "ADMIN") {
      throw new ManagedUserError("cannot_demote_self");
    }
    if (target.role === "ADMIN" && role !== "ADMIN") {
      await assertAdminCanBeRemoved(tx, target);
    }

    return tx.user.update({
      where: { id: targetId },
      data: {
        name,
        role,
        ...(target.role !== role
          ? { sessionVersion: { increment: 1 } }
          : {}),
      },
    });
  });
}

export async function setManagedUserDisabled(
  prisma,
  { actorId, targetId, disabled },
) {
  return withSerializedAdminWrite(prisma, actorId, async (tx) => {
    const target = await tx.user.findUnique({
      where: { id: targetId },
      select: { id: true, role: true, disabledAt: true },
    });
    if (!target) {
      throw new ManagedUserError("user_not_found");
    }
    if (disabled && targetId === actorId) {
      throw new ManagedUserError("cannot_disable_self");
    }

    const alreadyDisabled = Boolean(target.disabledAt);
    if (alreadyDisabled === disabled) {
      return target;
    }
    if (disabled) {
      await assertAdminCanBeRemoved(tx, target);
    }

    return tx.user.update({
      where: { id: targetId },
      data: {
        disabledAt: disabled ? new Date() : null,
        sessionVersion: { increment: 1 },
      },
    });
  });
}
