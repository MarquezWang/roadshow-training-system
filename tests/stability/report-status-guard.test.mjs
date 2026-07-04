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

async function getReportStatus(sessionId) {
  let response;

  try {
    response = await fetch(`${baseUrl}/training/${sessionId}/report/status`, {
      cache: "no-store",
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
  "report/status 正确处理已答但无录音与未回答基础题",
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
    const runPrefix = `stability-report-status-${Date.now()}-${randomUUID().slice(0, 8)}`;
    const userId = `${runPrefix}-user`;
    const projectId = `${runPrefix}-project`;
    const sessionIds = [];

    async function createFixture({
      name,
      answeredBaseCount,
      includeUnansweredDynamicFollowup = false,
    }) {
      const sessionId = `${runPrefix}-${name}`;
      const now = new Date();
      sessionIds.push(sessionId);

      await prisma.trainingSession.create({
        data: {
          id: sessionId,
          projectId,
          status: "QA_ENDED",
          pitchStartedAt: new Date(now.getTime() - 180_000),
          pitchEndedAt: new Date(now.getTime() - 120_000),
          pitchDurationSec: 60,
          qaStartedAt: new Date(now.getTime() - 90_000),
          qaEndedAt: now,
          qaDurationSec: 90,
          currentPageIndex: 1,
        },
      });

      for (let orderIndex = 1; orderIndex <= 3; orderIndex += 1) {
        const questionId = `${sessionId}-q${orderIndex}`;
        await prisma.trainingQuestion.create({
          data: {
            id: questionId,
            sessionId,
            projectId,
            orderIndex,
            questionText: `基础问题 ${orderIndex}`,
            questionType: "GENERAL",
            source: "AI",
            basis: "Stability fixture",
          },
        });

        if (orderIndex <= answeredBaseCount) {
          await prisma.trainingAnswer.create({
            data: {
              id: `${questionId}-answer`,
              sessionId,
              questionId,
              recordingId: null,
              answerText: `基础回答 ${orderIndex}`,
              startedAt: new Date(now.getTime() - 30_000),
              endedAt: now,
              durationSec: 30,
            },
          });
        }
      }

      if (includeUnansweredDynamicFollowup) {
        await prisma.trainingQuestion.create({
          data: {
            id: `${sessionId}-q4`,
            sessionId,
            projectId,
            orderIndex: 4,
            questionText: "动态追问",
            questionType: "FOLLOWUP",
            source: "DYNAMIC_FOLLOWUP",
            basis: "Stability fixture",
          },
        });
      }

      return sessionId;
    }

    async function assertStatusResponse(sessionId) {
      const result = await getReportStatus(sessionId);
      assert.notEqual(
        result.response.status,
        404,
        "本地 Next 服务未连接 STABILITY_TEST_DATABASE_URL 指向的数据库。",
      );
      assert.equal(result.response.status, 200);
      assert.ok(result.body);
      return result.body;
    }

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
          name: "Report Status Guard Fixture",
          field: "TEST",
          stage: "TEST",
          summary: "Isolated stability test fixture.",
          coreTechnology: "N/A",
          applicationScenario: "N/A",
          businessModel: "N/A",
          cooperationDemand: "N/A",
        },
      });

      await t.test("三道基础题已回答且均无录音时允许降级", async () => {
        const sessionId = await createFixture({
          name: "answered-without-recording",
          answeredBaseCount: 3,
        });
        const body = await assertStatusResponse(sessionId);

        assert.equal(body.qaTotalCount, 3);
        assert.equal(body.qaAnsweredWithoutRecordingCount, 3);
        assert.equal(body.qaUnansweredBaseQuestionCount, 0);
        assert.equal(body.qaTranscriptMissingCount, 3);
        assert.equal(body.canGenerateAnalysis, true);
      });

      // 与 report/status 路由保持一致：只等待实际进入过的题。
      // 如果用户在前面题目耗时过长，后续基础题没有机会进入，不应因此卡住报告生成。
      await t.test("未回答基础题不阻塞报告生成", async () => {
        const sessionId = await createFixture({
          name: "one-unanswered-base-question",
          answeredBaseCount: 2,
        });
        const body = await assertStatusResponse(sessionId);

        assert.equal(body.qaTotalCount, 2);
        assert.equal(body.qaTranscriptItems.length, 2);
        assert.equal(body.qaAnsweredWithoutRecordingCount, 2);
        assert.equal(body.qaTranscriptMissingCount, 2);
        assert.equal(body.qaUnansweredBaseQuestionCount, 1);
        assert.equal(body.canGenerateAnalysis, true);
      });

      await t.test("未回答动态追问不阻塞基础报告", async () => {
        const sessionId = await createFixture({
          name: "unanswered-dynamic-followup",
          answeredBaseCount: 3,
          includeUnansweredDynamicFollowup: true,
        });
        const body = await assertStatusResponse(sessionId);

        assert.equal(body.qaTotalCount, 3);
        assert.equal(body.qaAnsweredWithoutRecordingCount, 3);
        assert.equal(body.qaUnansweredBaseQuestionCount, 0);
        assert.equal(body.canGenerateAnalysis, true);
      });
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
