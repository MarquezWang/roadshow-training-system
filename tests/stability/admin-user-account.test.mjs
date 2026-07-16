import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";

import {
  changeManagedUserRole,
  setManagedUserDisabled,
} from "../../lib/admin-user-account.mjs";
import { findActiveAuthUser } from "../../lib/auth-user.mjs";

const databaseUrl = process.env.STABILITY_TEST_DATABASE_URL?.trim() ?? "";

function safetySkipReason() {
  const normalized = databaseUrl.toLowerCase();
  if (!normalized.startsWith("file:")) return "需要专用 SQLite 测试数据库。";
  if (!normalized.includes("test") && !normalized.includes("stability")) {
    return "测试数据库名称必须包含 test 或 stability。";
  }
  return null;
}

test(
  "用户停用会撤销会话，且并发管理操作不会移除最后一个启用管理员",
  { skip: safetySkipReason() || false },
  async (t) => {
    const { PrismaClient } = await import("@prisma/client");
    const prisma = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
    const prefix = `admin-guard-${Date.now()}-${randomUUID().slice(0, 8)}`;
    const adminA = `${prefix}-admin-a`;
    const adminB = `${prefix}-admin-b`;
    const team = `${prefix}-team`;

    try {
      await prisma.user.createMany({
        data: [
          { id: adminA, email: `${adminA}@example.test`, name: "Admin A", role: "ADMIN" },
          { id: adminB, email: `${adminB}@example.test`, name: "Admin B", role: "ADMIN" },
          { id: team, email: `${team}@example.test`, name: "Team", role: "TEAM" },
        ],
      });

      await t.test("停用和恢复都会增加 sessionVersion", async () => {
        const before = await prisma.user.findUniqueOrThrow({ where: { id: team } });
        const oldSession = {
          userId: team,
          sessionVersion: before.sessionVersion,
        };
        assert.ok(await findActiveAuthUser(prisma, oldSession));

        await setManagedUserDisabled(prisma, {
          actorId: adminA,
          targetId: team,
          disabled: true,
        });
        const disabled = await prisma.user.findUniqueOrThrow({ where: { id: team } });
        assert.ok(disabled.disabledAt);
        assert.equal(disabled.sessionVersion, before.sessionVersion + 1);
        assert.equal(await findActiveAuthUser(prisma, oldSession), null);

        await setManagedUserDisabled(prisma, {
          actorId: adminA,
          targetId: team,
          disabled: false,
        });
        const restored = await prisma.user.findUniqueOrThrow({ where: { id: team } });
        assert.equal(restored.disabledAt, null);
        assert.equal(restored.sessionVersion, before.sessionVersion + 2);
        assert.equal(await findActiveAuthUser(prisma, oldSession), null);
        assert.ok(
          await findActiveAuthUser(prisma, {
            userId: team,
            sessionVersion: restored.sessionVersion,
          }),
        );
      });

      await t.test("管理员不能停用自己", async () => {
        await assert.rejects(
          setManagedUserDisabled(prisma, {
            actorId: adminA,
            targetId: adminA,
            disabled: true,
          }),
          /cannot_disable_self/,
        );
      });

      await t.test("两个管理员并发停用对方后仍保留启用管理员", async () => {
        const results = await Promise.allSettled([
          setManagedUserDisabled(prisma, {
            actorId: adminA,
            targetId: adminB,
            disabled: true,
          }),
          setManagedUserDisabled(prisma, {
            actorId: adminB,
            targetId: adminA,
            disabled: true,
          }),
        ]);
        assert.ok(results.some((result) => result.status === "fulfilled"));
        assert.ok(results.some((result) => result.status === "rejected"));
        assert.ok(
          (await prisma.user.count({
            where: { role: "ADMIN", disabledAt: null },
          })) >= 1,
        );
      });

      await prisma.user.updateMany({
        where: { id: { in: [adminA, adminB] } },
        data: { disabledAt: null, role: "ADMIN" },
      });

      await t.test("两个管理员并发降级对方后仍保留启用管理员", async () => {
        const results = await Promise.allSettled([
          changeManagedUserRole(prisma, {
            actorId: adminA,
            targetId: adminB,
            name: "Admin B",
            role: "TEAM",
          }),
          changeManagedUserRole(prisma, {
            actorId: adminB,
            targetId: adminA,
            name: "Admin A",
            role: "TEAM",
          }),
        ]);
        assert.ok(results.some((result) => result.status === "fulfilled"));
        assert.ok(results.some((result) => result.status === "rejected"));
        assert.ok(
          (await prisma.user.count({
            where: { role: "ADMIN", disabledAt: null },
          })) >= 1,
        );
      });
    } finally {
      await prisma.user.deleteMany({ where: { id: { startsWith: prefix } } });
      await prisma.$disconnect();
    }
  },
);
