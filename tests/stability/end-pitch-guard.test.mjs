import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";

const testDatabaseUrl = process.env.STABILITY_TEST_DATABASE_URL?.trim() ?? "";
const baseUrl = (
  process.env.STABILITY_TEST_BASE_URL?.trim() || "http://localhost:3000"
).replace(/\/$/, "");

function getSafetySkipReason() {
  if (!testDatabaseUrl) {
    return "未配置 STABILITY_TEST_DATABASE_URL；为避免写入开发数据库，本测试已跳过。";
  }

  const normalizedUrl = testDatabaseUrl.toLowerCase();
  if (!normalizedUrl.startsWith("file:")) {
    return "STABILITY_TEST_DATABASE_URL 必须指向专用 SQLite file: 数据库。";
  }

  if (!normalizedUrl.includes("test") && !normalizedUrl.includes("stability")) {
    return "测试数据库 URL 必须包含 test 或 stability，以避免误用开发数据库。";
  }

  if (normalizedUrl.endsWith("dev.db") || normalizedUrl.endsWith("prod.db")) {
    return "禁止使用 dev.db 或 prod.db 运行稳定性测试。";
  }

  return null;
}

async function postEndPitch(sessionId) {
  let response;

  try {
    response = await fetch(`${baseUrl}/training/${sessionId}/end-pitch`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        pitchDurationSec: 12,
        pageIndex: 3,
      }),
    });
  } catch (error) {
    throw new Error(
      `无法访问 ${baseUrl}。请确认使用测试数据库启动了本地 Next 服务。原始错误：${error instanceof Error ? error.message : String(error)}`,
    );
  }

  const body = await response.json().catch(() => null);
  return { response, body };
}

const safetySkipReason = getSafetySkipReason();

test(
  "end-pitch 仅允许 PITCHING 结束，并保持其它状态幂等",
  { skip: safetySkipReason || false },
  async (t) => {
    const { PrismaClient } = await import("@prisma/client");
    const prisma = new PrismaClient({
      datasources: {
        db: {
          url: testDatabaseUrl,
        },
      },
    });
    const runPrefix = `stability-end-pitch-${Date.now()}-${randomUUID().slice(0, 8)}`;
    const userId = `${runPrefix}-user`;
    const projectId = `${runPrefix}-project`;
    const statuses = [
      "PITCHING",
      "QA_READY",
      "QAING",
      "FINISHED",
      "ABORTED",
      "CREATED",
    ];
    const sessionIds = statuses.map((status) =>
      `${runPrefix}-${status.toLowerCase()}`,
    );

    try {
      await prisma.user.create({
        data: {
          id: userId,
          name: "Stability Test User",
          email: `${runPrefix}@example.test`,
          role: "TEAM",
        },
      });
      await prisma.project.create({
        data: {
          id: projectId,
          ownerId: userId,
          name: "End Pitch Guard Fixture",
          field: "TEST",
          stage: "TEST",
          summary: "Isolated stability test fixture.",
          coreTechnology: "N/A",
          applicationScenario: "N/A",
          businessModel: "N/A",
          cooperationDemand: "N/A",
        },
      });

      for (const [index, status] of statuses.entries()) {
        const sessionId = sessionIds[index];
        const alreadyEnded = ["QA_READY", "QAING", "FINISHED"].includes(
          status,
        );
        const originalPitchEndedAt = alreadyEnded
          ? new Date(Date.now() - 60_000)
          : null;

        await prisma.trainingSession.create({
          data: {
            id: sessionId,
            projectId,
            status,
            pitchStartedAt:
              status === "CREATED" ? null : new Date(Date.now() - 120_000),
            pitchEndedAt: originalPitchEndedAt,
            pitchDurationSec: alreadyEnded ? 60 : null,
            currentPageIndex: 2,
          },
        });

        if (alreadyEnded) {
          await prisma.slideEvent.create({
            data: {
              sessionId,
              fileId: null,
              pageIndex: 2,
              eventType: "END",
              elapsedSec: 60,
            },
          });
        }

        await t.test(`${status} 状态`, async () => {
          const beforeEndEventCount = await prisma.slideEvent.count({
            where: {
              sessionId,
              eventType: "END",
            },
          });
          const { response, body } = await postEndPitch(sessionId);

          assert.notEqual(
            response.status,
            404,
            "本地 Next 服务未连接 STABILITY_TEST_DATABASE_URL 指向的数据库。",
          );

          const savedSession = await prisma.trainingSession.findUniqueOrThrow({
            where: {
              id: sessionId,
            },
          });
          const afterEndEventCount = await prisma.slideEvent.count({
            where: {
              sessionId,
              eventType: "END",
            },
          });

          if (status === "PITCHING") {
            assert.equal(response.status, 200);
            assert.equal(savedSession.status, "QA_READY");
            assert.ok(savedSession.pitchEndedAt);
            assert.equal(afterEndEventCount, beforeEndEventCount + 1);

            const repeated = await postEndPitch(sessionId);
            assert.equal(repeated.response.status, 200);
            assert.equal(repeated.body?.skipped, true);
            assert.equal(repeated.body?.reason, "pitch_already_ended");
            assert.equal(
              await prisma.slideEvent.count({
                where: {
                  sessionId,
                  eventType: "END",
                },
              }),
              beforeEndEventCount + 1,
            );
            return;
          }

          assert.equal(savedSession.status, status);
          assert.equal(
            savedSession.pitchEndedAt?.getTime() ?? null,
            originalPitchEndedAt?.getTime() ?? null,
          );
          assert.equal(afterEndEventCount, beforeEndEventCount);

          if (alreadyEnded) {
            assert.equal(response.status, 200);
            assert.equal(body?.skipped, true);
            assert.equal(body?.reason, "pitch_already_ended");
          } else {
            assert.equal(response.status, 409);
          }
        });
      }
    } finally {
      await prisma.trainingSession.deleteMany({
        where: {
          id: {
            in: sessionIds,
          },
        },
      });
      await prisma.project.deleteMany({
        where: {
          id: projectId,
        },
      });
      await prisma.user.deleteMany({
        where: {
          id: userId,
        },
      });
      await prisma.$disconnect();
    }
  },
);
