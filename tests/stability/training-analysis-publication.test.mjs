import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";

import { publishTrainingAnalysis } from "../../lib/training-analysis-publication.mjs";

const databaseUrl = process.env.STABILITY_TEST_DATABASE_URL?.trim() ?? "";

function safetySkipReason() {
  const normalized = databaseUrl.toLowerCase();
  if (!normalized.startsWith("file:")) return "需要专用 SQLite 测试数据库。";
  if (!normalized.includes("test") && !normalized.includes("stability")) {
    return "测试数据库名称必须包含 test 或 stability。";
  }
  return null;
}

function analysisData(prefix, status, inputHash) {
  return {
    id: `${prefix}-${randomUUID()}`,
    projectId: `${prefix}-project`,
    status,
    analysisType: "PITCH",
    durationSec: 60,
    summary: status === "COMPLETED" ? "old report" : "",
    strengthsJson: "[]",
    weaknessesJson: "[]",
    suggestionsJson: "[]",
    coverageJson: "[]",
    timingJson: "{}",
    slideSyncJson: "{}",
    riskQuestionsJson: "[]",
    rawResultJson: "{}",
    inputHash,
    promptVersion: "pitch-performance-analysis:test",
    schemaVersion: "training-analysis-result:test",
    modelVersion: "model-test",
    ruleVersion: "pitch-analysis-policy:test",
  };
}

test(
  "报告只有成功发布且持有当前任务租约时才切换 Session 指针",
  { skip: safetySkipReason() || false },
  async (t) => {
    const { PrismaClient } = await import("@prisma/client");
    const prisma = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
    const prefix = `analysis-publish-${Date.now()}-${randomUUID().slice(0, 8)}`;
    const userId = `${prefix}-user`;
    const projectId = `${prefix}-project`;
    const sessionId = `${prefix}-session`;
    const jobKey = `training-analysis:${sessionId}`;
    const oldData = analysisData(prefix, "COMPLETED", "v3:old");

    try {
      await prisma.user.create({
        data: { id: userId, email: `${prefix}@example.test`, name: prefix },
      });
      await prisma.project.create({
        data: {
          id: projectId,
          ownerId: userId,
          name: prefix,
          field: "TEST",
          stage: "TEST",
          summary: "fixture",
          coreTechnology: "fixture",
          applicationScenario: "fixture",
          businessModel: "fixture",
          cooperationDemand: "fixture",
        },
      });
      await prisma.trainingSession.create({
        data: { id: sessionId, projectId, status: "QA_ENDED" },
      });
      await prisma.trainingAnalysis.create({
        data: { ...oldData, sessionId },
      });
      await prisma.trainingSession.update({
        where: { id: sessionId },
        data: { currentAnalysisId: oldData.id },
      });

      await t.test("失败的新版本不会替换旧报告", async () => {
        const failed = analysisData(prefix, "FAILED", "v3:failed");
        await prisma.trainingAnalysis.create({ data: { ...failed, sessionId } });
        const session = await prisma.trainingSession.findUniqueOrThrow({
          where: { id: sessionId },
        });
        assert.equal(session.currentAnalysisId, oldData.id);
      });

      await t.test("当前 owner 成功发布后原子切换指针并结清任务", async () => {
        const processing = analysisData(prefix, "PROCESSING", "v3:new");
        await prisma.trainingAnalysis.create({ data: { ...processing, sessionId } });
        await prisma.asyncJob.create({
          data: {
            jobKey,
            jobType: "TRAINING_ANALYSIS",
            resourceId: sessionId,
            status: "RUNNING",
            ownerToken: "owner-current",
            leaseExpiresAt: new Date(Date.now() + 60_000),
          },
        });

        const published = await publishTrainingAnalysis(prisma, {
          jobKey,
          ownerToken: "owner-current",
          sessionId,
          analysisId: processing.id,
          inputHash: processing.inputHash,
          data: { summary: "new report", overallScore: 88 },
        });
        assert.equal(published.status, "COMPLETED");
        assert.equal(published.summary, "new report");
        assert.equal(
          (
            await prisma.trainingSession.findUniqueOrThrow({
              where: { id: sessionId },
            })
          ).currentAnalysisId,
          processing.id,
        );
        const completedJob = await prisma.asyncJob.findUniqueOrThrow({
          where: { jobKey },
        });
        assert.equal(completedJob.status, "COMPLETED");
        assert.equal(completedJob.ownerToken, "");
        assert.equal(completedJob.leaseExpiresAt, null);
      });

      await t.test("失效 owner 无法发布或改变当前指针", async () => {
        const currentId = (
          await prisma.trainingSession.findUniqueOrThrow({ where: { id: sessionId } })
        ).currentAnalysisId;
        const stale = analysisData(prefix, "PROCESSING", "v3:stale-owner");
        await prisma.trainingAnalysis.create({ data: { ...stale, sessionId } });
        await prisma.asyncJob.update({
          where: { jobKey },
          data: {
            ownerToken: "owner-replacement",
            status: "RUNNING",
            leaseExpiresAt: new Date(Date.now() + 60_000),
          },
        });

        await assert.rejects(
          publishTrainingAnalysis(prisma, {
            jobKey,
            ownerToken: "owner-stale",
            sessionId,
            analysisId: stale.id,
            inputHash: stale.inputHash,
            data: { summary: "must not publish" },
          }),
          /analysis_job_owner_lost/,
        );
        assert.equal(
          (
            await prisma.trainingSession.findUniqueOrThrow({
              where: { id: sessionId },
            })
          ).currentAnalysisId,
          currentId,
        );
      });
    } finally {
      await prisma.asyncJob.deleteMany({ where: { resourceId: sessionId } });
      await prisma.trainingAnalysis.deleteMany({ where: { sessionId } });
      await prisma.trainingSession.deleteMany({ where: { id: sessionId } });
      await prisma.project.deleteMany({ where: { id: projectId } });
      await prisma.user.deleteMany({ where: { id: userId } });
      await prisma.$disconnect();
    }
  },
);
