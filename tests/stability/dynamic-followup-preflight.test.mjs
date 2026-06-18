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

async function postDynamicFollowup(sessionId) {
  let response;

  try {
    response = await fetch(
      `${baseUrl}/training/${sessionId}/qa/questions/dynamic-followup`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ debug: true }),
      },
    );
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
  "dynamic follow-up 对内容不足或明显离题的 Pitch 跳过 Q4",
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
    const runPrefix = `stability-dynamic-followup-${Date.now()}-${randomUUID().slice(0, 8)}`;
    const userId = `${runPrefix}-user`;
    const projectId = `${runPrefix}-project`;
    const sessionIds = [];

    async function createFixture({ name, transcriptText, existingQ4 = false }) {
      const sessionId = `${runPrefix}-${name}`;
      const recordingId = `${sessionId}-pitch-recording`;
      const transcriptId = `${sessionId}-pitch-transcript`;
      const baseQuestionIds = [1, 2, 3].map(
        (orderIndex) => `${sessionId}-q${orderIndex}`,
      );
      const existingQ4Id = `${sessionId}-q4`;
      const now = new Date();
      sessionIds.push(sessionId);

      await prisma.trainingSession.create({
        data: {
          id: sessionId,
          projectId,
          status: "QA_READY",
          pitchStartedAt: new Date(now.getTime() - 90_000),
          pitchEndedAt: new Date(now.getTime() - 30_000),
          pitchDurationSec: 60,
          currentPageIndex: 1,
        },
      });
      await prisma.trainingRecording.create({
        data: {
          id: recordingId,
          sessionId,
          projectId,
          phase: "PITCH",
          status: "RECORDED",
          originalName: "fixture.webm",
          fileName: `${recordingId}.webm`,
          filePath: `stability-fixtures/${recordingId}.webm`,
          mimeType: "audio/webm",
          sizeBytes: 1,
          durationSec: 60,
          startedAt: new Date(now.getTime() - 90_000),
          endedAt: new Date(now.getTime() - 30_000),
        },
      });
      await prisma.trainingTranscript.create({
        data: {
          id: transcriptId,
          recordingId,
          sessionId,
          projectId,
          status: "COMPLETED",
          source: "XFYUN",
          language: "zh-CN",
          text: transcriptText,
          startedAt: new Date(now.getTime() - 30_000),
          completedAt: now,
        },
      });
      await prisma.trainingQuestion.createMany({
        data: baseQuestionIds.map((id, index) => ({
          id,
          sessionId,
          projectId,
          orderIndex: index + 1,
          questionText: `基础问题 ${index + 1}`,
          questionType: "GENERAL",
          source: "AI",
          basis: "Stability fixture",
        })),
      });

      if (existingQ4) {
        await prisma.trainingQuestion.create({
          data: {
            id: existingQ4Id,
            sessionId,
            projectId,
            orderIndex: 4,
            questionText: "已有动态追问",
            questionType: "FOLLOWUP",
            source: "DYNAMIC_FOLLOWUP",
            basis: "Stability fixture",
          },
        });
      }

      return {
        sessionId,
        baseQuestionIds,
        existingQ4Id,
      };
    }

    async function assertSuccessfulResponse(sessionId) {
      const result = await postDynamicFollowup(sessionId);
      assert.notEqual(
        result.response.status,
        404,
        "本地 Next 服务未连接 STABILITY_TEST_DATABASE_URL 指向的数据库。",
      );
      assert.notEqual(
        result.body?.reason,
        "experiment_disabled",
        "启动本地 Next 服务时必须设置 DYNAMIC_FOLLOWUP_EXPERIMENT=true。",
      );
      assert.equal(result.response.status, 200);
      assert.ok(result.body);
      return result.body;
    }

    async function assertBaseQuestionsUnchanged(fixture, originalQuestions) {
      const savedQuestions = await prisma.trainingQuestion.findMany({
        where: {
          id: {
            in: fixture.baseQuestionIds,
          },
        },
        orderBy: {
          orderIndex: "asc",
        },
        select: {
          id: true,
          orderIndex: true,
          questionText: true,
          questionType: true,
          source: true,
          basis: true,
        },
      });
      assert.deepEqual(savedQuestions, originalQuestions);
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
          name: "稀疏测试项目",
          field: "",
          stage: "",
          summary: "",
          coreTechnology: "",
          applicationScenario: "",
          businessModel: "",
          cooperationDemand: "",
        },
      });

      await t.test("项目资料稀疏且 Pitch 明显离题时跳过", async () => {
        const unrelatedTranscript =
          "不轻信陌生来电，不点击陌生链接，不向他人泄漏验证码。网上贷款凡是要求先缴费的都是诈骗，刷单刷信誉同样属于诈骗。遇到陌生人要求转账时，应立即停止操作并联系家人核实。请大家保护个人信息，提高防诈骗意识，谨防中奖、陌生链接和冒充客服骗局。";
        const fixture = await createFixture({
          name: "unrelated-pitch",
          transcriptText: unrelatedTranscript,
        });
        const originalQuestions = await prisma.trainingQuestion.findMany({
          where: {
            id: {
              in: fixture.baseQuestionIds,
            },
          },
          orderBy: {
            orderIndex: "asc",
          },
          select: {
            id: true,
            orderIndex: true,
            questionText: true,
            questionType: true,
            source: true,
            basis: true,
          },
        });
        const body = await assertSuccessfulResponse(fixture.sessionId);

        assert.equal(body.ok, true);
        assert.equal(body.skipped, true);
        assert.equal(body.reason, "insufficient_project_pitch_content");
        assert.equal(
          await prisma.trainingQuestion.count({
            where: {
              sessionId: fixture.sessionId,
              source: "DYNAMIC_FOLLOWUP",
            },
          }),
          0,
        );
        await assertBaseQuestionsUnchanged(fixture, originalQuestions);
      });

      await t.test("Pitch 内容过短时跳过", async () => {
        const fixture = await createFixture({
          name: "short-pitch",
          transcriptText: "好的，谢谢",
        });
        const body = await assertSuccessfulResponse(fixture.sessionId);

        assert.equal(body.skipped, true);
        assert.equal(body.reason, "pitch_transcript_too_short");
        assert.equal(
          await prisma.trainingQuestion.count({
            where: {
              sessionId: fixture.sessionId,
              source: "DYNAMIC_FOLLOWUP",
            },
          }),
          0,
        );
      });

      await t.test("已有 Q4 时重复调用保持幂等", async () => {
        const fixture = await createFixture({
          name: "existing-q4",
          transcriptText: "好的，谢谢",
          existingQ4: true,
        });
        const body = await assertSuccessfulResponse(fixture.sessionId);

        assert.equal(body.ok, true);
        assert.equal(body.createdQuestionId, fixture.existingQ4Id);
        assert.equal(
          await prisma.trainingQuestion.count({
            where: {
              sessionId: fixture.sessionId,
              source: "DYNAMIC_FOLLOWUP",
            },
          }),
          1,
        );
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
