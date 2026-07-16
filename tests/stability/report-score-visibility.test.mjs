import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";

const databaseUrl = process.env.STABILITY_TEST_DATABASE_URL?.trim() ?? "";
const baseUrl = (
  process.env.STABILITY_TEST_BASE_URL?.trim() || "http://localhost:3000"
).replace(/\/$/, "");

function getSafetySkipReason() {
  const normalizedUrl = databaseUrl.toLowerCase();

  if (!normalizedUrl.startsWith("file:")) {
    return "需要专用 SQLite 测试数据库。";
  }

  if (!normalizedUrl.includes("test") && !normalizedUrl.includes("stability")) {
    return "测试数据库名称必须包含 test 或 stability。";
  }

  if (normalizedUrl.endsWith("dev.db") || normalizedUrl.endsWith("prod.db")) {
    return "禁止使用 dev.db 或 prod.db 运行稳定性测试。";
  }

  return null;
}

test(
  "报告页面根据显式 fallback 元数据展示或隐藏训练分数",
  { skip: getSafetySkipReason() || false },
  async (t) => {
    const { PrismaClient } = await import("@prisma/client");
    const prisma = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
    const prefix = `report-score-visibility-${Date.now()}-${randomUUID().slice(0, 8)}`;
    const userId = `${prefix}-user`;
    const projectId = `${prefix}-project`;
    const sessionIds = [];

    async function createReportFixture({
      name,
      score,
      isFallback,
      fallbackReason,
      summary,
    }) {
      const sessionId = `${prefix}-${name}`;
      const recordingId = `${sessionId}-recording`;
      const transcriptId = `${sessionId}-transcript`;
      const analysisId = `${sessionId}-analysis`;
      const now = new Date();
      const transcriptText =
        "本轮路演完整介绍了项目背景、核心技术、客户验证、商业模式、竞争壁垒、实施计划和融资需求，并用测试数据与真实案例支撑关键结论。".repeat(
          8,
        );
      sessionIds.push(sessionId);

      await prisma.trainingSession.create({
        data: {
          id: sessionId,
          projectId,
          status: "FINISHED",
          pitchStartedAt: new Date(now.getTime() - 300_000),
          pitchEndedAt: new Date(now.getTime() - 120_000),
          pitchDurationSec: 180,
          qaStartedAt: new Date(now.getTime() - 110_000),
          qaEndedAt: now,
          qaDurationSec: 110,
        },
      });

      await prisma.trainingRecording.create({
        data: {
          id: recordingId,
          sessionId,
          projectId,
          phase: "PITCH",
          status: "RECORDED",
          originalName: "report-score-visibility.webm",
          fileName: `${recordingId}.webm`,
          filePath: `uploads/training/${recordingId}.webm`,
          mimeType: "audio/webm",
          sizeBytes: 1024,
          durationSec: 180,
        },
      });

      await prisma.trainingTranscript.create({
        data: {
          id: transcriptId,
          recordingId,
          sessionId,
          projectId,
          status: "COMPLETED",
          source: "MANUAL",
          text: transcriptText,
          completedAt: now,
        },
      });

      for (let orderIndex = 1; orderIndex <= 2; orderIndex += 1) {
        const questionId = `${sessionId}-q${orderIndex}`;
        await prisma.trainingQuestion.create({
          data: {
            id: questionId,
            sessionId,
            projectId,
            orderIndex,
            questionText: `报告展示测试问题 ${orderIndex}`,
            questionType: "GENERAL",
            source: "AI",
          },
        });
        await prisma.trainingAnswer.create({
          data: {
            id: `${questionId}-answer`,
            sessionId,
            questionId,
            answerText: `这是第 ${orderIndex} 道问题的完整回答，包含数据、案例和下一步计划。`,
            revealedQuestionText: true,
            startedAt: new Date(now.getTime() - 60_000),
            endedAt: now,
            durationSec: 60,
          },
        });
      }

      await prisma.trainingAnalysis.create({
        data: {
          id: analysisId,
          sessionId,
          projectId,
          transcriptId,
          status: "COMPLETED",
          analysisType: "PITCH",
          durationSec: 180,
          pageCount: 6,
          slideEventCount: 5,
          overallScore: score,
          summary,
          strengthsJson: JSON.stringify(["表达结构完整"]),
          weaknessesJson: JSON.stringify(["可继续补充量化证据"]),
          suggestionsJson: JSON.stringify(["保持结论与证据对应"]),
          coverageJson: "[]",
          timingJson: "{}",
          slideSyncJson: "{}",
          riskQuestionsJson: "[]",
          rawResultJson: JSON.stringify({
            onePageSummary: {
              conclusion: summary,
              strongestPoint: "表达结构完整",
              biggestWeakness: "仍可补充量化证据",
              nextTrainingFocus: "强化数据与结论的对应关系",
              readinessAdvice: "可以继续进行正式展示准备",
            },
            diagnostics: { content: [], delivery: [], qa: [] },
            actionItems: [],
            nextTrainingTasks: [],
            qaReviews: [],
          }),
          errorMessage: null,
          isFallback,
          fallbackReason,
        },
      });

      await prisma.trainingSession.update({
        where: { id: sessionId },
        data: { currentAnalysisId: analysisId },
      });

      return sessionId;
    }

    async function fetchReport(sessionId) {
      const response = await fetch(`${baseUrl}/training/${sessionId}/report`, {
        cache: "no-store",
        headers: { Accept: "text/html" },
        redirect: "manual",
      });
      const html = await response.text();

      assert.notEqual(
        response.status,
        404,
        "本地 Next 服务未连接 STABILITY_TEST_DATABASE_URL 指向的数据库。",
      );
      assert.equal(response.status, 200);
      return html;
    }

    try {
      await prisma.user.create({
        data: {
          id: userId,
          name: "Report Score Visibility User",
          email: `${prefix}@example.test`,
          role: "TEAM",
        },
      });
      await prisma.project.create({
        data: {
          id: projectId,
          ownerId: userId,
          name: "Report Score Visibility Project",
          field: "TEST",
          stage: "TRL 6",
          summary: "Isolated report rendering fixture.",
          coreTechnology: "N/A",
          applicationScenario: "N/A",
          businessModel: "N/A",
          cooperationDemand: "N/A",
        },
      });

      await t.test("显式非 fallback 报告即使文案命中旧关键词仍显示分数", async () => {
        const sessionId = await createReportFixture({
          name: "normal",
          score: 82,
          isFallback: false,
          fallbackReason: null,
          summary: "结构化 JSON 解析失败是本轮讨论主题，但当前报告本身完整。",
        });
        const html = await fetchReport(sessionId);

        assert.ok(html.includes("本次训练表现分 82/100"));
        assert.ok(!html.includes("当前为降级报告"));
        assert.ok(!html.includes("本次训练报告不完整，分数已隐藏"));
      });

      await t.test("显式 fallback 报告隐藏内部诊断分和分母", async () => {
        const sessionId = await createReportFixture({
          name: "fallback",
          score: 37,
          isFallback: true,
          fallbackReason: "NO_ANALYZABLE_TEXT",
          summary: "当前报告由显式状态标记为不完整报告。",
        });
        const html = await fetchReport(sessionId);

        assert.ok(html.includes("当前为降级报告"));
        assert.ok(html.includes("暂不建议参考本次分数"));
        assert.ok(html.includes("本次训练报告不完整，分数已隐藏"));
        assert.ok(!html.includes("本次训练报告不完整 37/100"));
      });
    } finally {
      await prisma.trainingSession.updateMany({
        where: { id: { in: sessionIds } },
        data: { currentAnalysisId: null },
      });
      await prisma.trainingSession.deleteMany({
        where: { id: { in: sessionIds } },
      });
      await prisma.project.deleteMany({ where: { id: projectId } });
      await prisma.user.deleteMany({ where: { id: userId } });
      await prisma.$disconnect();
    }
  },
);
