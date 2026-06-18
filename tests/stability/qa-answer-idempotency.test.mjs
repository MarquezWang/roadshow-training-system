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

async function postAnswer(sessionId, questionId, body) {
  let response;

  try {
    response = await fetch(
      `${baseUrl}/training/${sessionId}/qa/questions/${questionId}/answer`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
      },
    );
  } catch (error) {
    throw new Error(
      `无法访问 ${baseUrl}。请确认使用测试数据库启动了本地 Next 服务。原始错误：${error instanceof Error ? error.message : String(error)}`,
    );
  }

  const responseBody = await response.json().catch(() => null);
  return { response, body: responseBody };
}

const safetySkipReason = getSafetySkipReason();

test(
  "QA answer 重复提交只增强数据，不覆盖已有有效内容",
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
    const runPrefix = `stability-qa-answer-${Date.now()}-${randomUUID().slice(0, 8)}`;
    const userId = `${runPrefix}-user`;
    const projectId = `${runPrefix}-project`;
    const sessionIds = [];

    async function createFixture({
      name,
      answerText,
      withRecordingA = false,
      withRecordingB = false,
    }) {
      const sessionId = `${runPrefix}-${name}`;
      const questionId = `${sessionId}-q1`;
      const nextQuestionId = `${sessionId}-q2`;
      const recordingAId = `${sessionId}-recording-a`;
      const recordingBId = `${sessionId}-recording-b`;
      const startedAt = new Date(Date.now() - 45_000);
      const endedAt = new Date(Date.now() - 15_000);
      const durationSec = 30;
      sessionIds.push(sessionId);

      await prisma.trainingSession.create({
        data: {
          id: sessionId,
          projectId,
          status: "QAING",
          pitchStartedAt: new Date(Date.now() - 180_000),
          pitchEndedAt: new Date(Date.now() - 120_000),
          pitchDurationSec: 60,
          qaStartedAt: new Date(Date.now() - 60_000),
          currentPageIndex: 1,
        },
      });
      await prisma.trainingQuestion.createMany({
        data: [
          {
            id: questionId,
            sessionId,
            projectId,
            orderIndex: 1,
            questionText: "基础问题 1",
            questionType: "GENERAL",
            source: "AI",
            basis: "Stability fixture",
          },
          {
            id: nextQuestionId,
            sessionId,
            projectId,
            orderIndex: 2,
            questionText: "基础问题 2",
            questionType: "GENERAL",
            source: "AI",
            basis: "Stability fixture",
          },
        ],
      });

      for (const recordingId of [
        ...(withRecordingA ? [recordingAId] : []),
        ...(withRecordingB ? [recordingBId] : []),
      ]) {
        await prisma.trainingRecording.create({
          data: {
            id: recordingId,
            sessionId,
            projectId,
            phase: "QA",
            status: "RECORDED",
            originalName: "fixture.webm",
            fileName: `${recordingId}.webm`,
            filePath: `stability-fixtures/${recordingId}.webm`,
            mimeType: "audio/webm",
            sizeBytes: 1,
            durationSec,
            startedAt,
            endedAt,
          },
        });
      }

      await prisma.trainingAnswer.create({
        data: {
          id: `${questionId}-answer`,
          sessionId,
          questionId,
          recordingId: withRecordingA ? recordingAId : null,
          answerText,
          revealedQuestionText: true,
          startedAt,
          endedAt,
          durationSec,
        },
      });

      return {
        sessionId,
        questionId,
        recordingAId,
        recordingBId,
        startedAt,
        endedAt,
        durationSec,
      };
    }

    async function submitAndReadAnswer(fixture, body) {
      const result = await postAnswer(
        fixture.sessionId,
        fixture.questionId,
        body,
      );
      assert.notEqual(
        result.response.status,
        404,
        "本地 Next 服务未连接 STABILITY_TEST_DATABASE_URL 指向的数据库。",
      );
      assert.equal(result.response.status, 200);
      assert.equal(result.body?.completed, false);

      return prisma.trainingAnswer.findUniqueOrThrow({
        where: {
          questionId: fixture.questionId,
        },
      });
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
          name: "QA Answer Idempotency Fixture",
          field: "TEST",
          stage: "TEST",
          summary: "Isolated stability test fixture.",
          coreTechnology: "N/A",
          applicationScenario: "N/A",
          businessModel: "N/A",
          cooperationDemand: "N/A",
        },
      });

      await t.test("空重复请求不清空 recording 和有效文本", async () => {
        const originalText =
          "这是一个较完整的答辩回答，包含技术、市场和风险说明。";
        const fixture = await createFixture({
          name: "empty-retry",
          answerText: originalText,
          withRecordingA: true,
        });
        const savedAnswer = await submitAndReadAnswer(fixture, {
          answerText: "",
          recordingId: null,
          answerStartedAt: new Date().toISOString(),
          finish: false,
        });

        assert.equal(savedAnswer.recordingId, fixture.recordingAId);
        assert.equal(savedAnswer.answerText, originalText);
        assert.equal(savedAnswer.startedAt?.getTime(), fixture.startedAt.getTime());
        assert.equal(savedAnswer.endedAt?.getTime(), fixture.endedAt.getTime());
        assert.equal(savedAnswer.durationSec, fixture.durationSec);
      });

      await t.test("较短文本不覆盖较长文本", async () => {
        const originalText =
          "这是一个较完整的答辩回答，包含技术、市场和风险说明。";
        const fixture = await createFixture({
          name: "shorter-text",
          answerText: originalText,
        });
        const savedAnswer = await submitAndReadAnswer(fixture, {
          answerText: "好的",
          finish: false,
        });

        assert.equal(savedAnswer.answerText, originalText);
      });

      await t.test("更长有效文本可以补充", async () => {
        const improvedText =
          "这是补充后的完整回答，进一步说明了技术方案、市场验证、实施计划和主要风险。";
        const fixture = await createFixture({
          name: "longer-text",
          answerText: "好的",
        });
        const savedAnswer = await submitAndReadAnswer(fixture, {
          answerText: improvedText,
          finish: false,
        });

        assert.equal(savedAnswer.answerText, improvedText);
      });

      await t.test("不同 recording 不覆盖已有 recording", async () => {
        const fixture = await createFixture({
          name: "different-recording",
          answerText: "已有有效回答。",
          withRecordingA: true,
          withRecordingB: true,
        });
        const savedAnswer = await submitAndReadAnswer(fixture, {
          answerText: "已有有效回答。",
          recordingId: fixture.recordingBId,
          finish: false,
        });

        assert.equal(savedAnswer.recordingId, fixture.recordingAId);
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
