import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readdir, rm } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

const databaseUrl = process.env.STABILITY_TEST_DATABASE_URL?.trim() ?? "";
const baseUrl = (
  process.env.STABILITY_TEST_BASE_URL?.trim() || "http://localhost:3000"
).replace(/\/$/, "");

function safetySkipReason() {
  const normalized = databaseUrl.toLowerCase();
  if (!normalized.startsWith("file:")) return "需要专用 SQLite 测试数据库。";
  if (!normalized.includes("test") && !normalized.includes("stability")) {
    return "测试数据库名称必须包含 test 或 stability。";
  }
  return null;
}

async function post(path, body = {}) {
  const response = await fetch(`${baseUrl}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return {
    response,
    body: await response.json().catch(() => null),
  };
}

test(
  "训练状态转换使用 CAS，事件和 QA 结束不会破坏既有数据",
  { skip: safetySkipReason() || false },
  async (t) => {
    const { PrismaClient } = await import("@prisma/client");
    const prisma = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
    const prefix = `state-guard-${Date.now()}-${randomUUID().slice(0, 8)}`;
    const userId = `${prefix}-user`;
    const projectId = `${prefix}-project`;
    const sessionIds = [];

    async function createSession(name, status) {
      const id = `${prefix}-${name}`;
      sessionIds.push(id);
      return prisma.trainingSession.create({
        data: {
          id,
          projectId,
          status,
          pitchStartedAt: status === "PITCHING" ? new Date() : null,
          qaStartedAt: status === "QAING" ? new Date(Date.now() - 30_000) : null,
        },
      });
    }

    try {
      await prisma.user.create({
        data: {
          id: userId,
          name: "State Guard User",
          email: `${prefix}@example.test`,
          role: "TEAM",
        },
      });
      await prisma.project.create({
        data: {
          id: projectId,
          ownerId: userId,
          name: "State Guard Project",
          field: "TEST",
          stage: "TRL 4",
          summary: "fixture",
          coreTechnology: "fixture",
          applicationScenario: "fixture",
          businessModel: "fixture",
          cooperationDemand: "fixture",
        },
      });

      await t.test("并发 start-pitch 只写入一个 START 事件", async () => {
        const session = await createSession("concurrent-start", "CREATED");
        const results = await Promise.all([
          post(`/training/${session.id}/start-pitch`),
          post(`/training/${session.id}/start-pitch`),
        ]);

        assert.ok(results.every(({ response }) => [200, 409].includes(response.status)));
        assert.equal(
          await prisma.slideEvent.count({
            where: { sessionId: session.id, eventType: "START" },
          }),
          1,
        );
        assert.equal(
          (await prisma.trainingSession.findUniqueOrThrow({ where: { id: session.id } }))
            .status,
          "PITCHING",
        );
      });

      await t.test("通用事件接口拒绝 START 和 END", async () => {
        const session = await createSession("event-types", "CREATED");
        for (const eventType of ["START", "END"]) {
          const result = await post(`/training/${session.id}/events`, {
            eventType,
            pageIndex: 9,
            elapsedSec: 10,
          });
          assert.equal(result.response.status, 400);
        }
        const saved = await prisma.trainingSession.findUniqueOrThrow({
          where: { id: session.id },
        });
        assert.equal(saved.currentPageIndex, 0);
        assert.equal(await prisma.slideEvent.count({ where: { sessionId: session.id } }), 0);
      });

      await t.test("qa/end 空重试保留答案和录音", async () => {
        const session = await createSession("qa-end-preserve", "QAING");
        const questionId = `${session.id}-q1`;
        const recordingId = `${session.id}-recording`;
        await prisma.trainingQuestion.create({
          data: {
            id: questionId,
            sessionId: session.id,
            projectId,
            orderIndex: 1,
            questionText: "测试问题",
          },
        });
        await prisma.trainingRecording.create({
          data: {
            id: recordingId,
            sessionId: session.id,
            projectId,
            phase: "QA",
            fileName: "fixture.webm",
            filePath: "uploads/training/fixture.webm",
            mimeType: "audio/webm",
            sizeBytes: 1,
          },
        });
        await prisma.trainingAnswer.create({
          data: {
            sessionId: session.id,
            questionId,
            recordingId,
            answerText: "已有完整回答",
            revealedQuestionText: true,
          },
        });

        const result = await post(`/training/${session.id}/qa/end`, {
          questionId,
          answerText: "",
          recordingId: null,
          revealedQuestionText: false,
        });
        assert.equal(result.response.status, 200);
        const answer = await prisma.trainingAnswer.findUniqueOrThrow({
          where: { questionId },
        });
        assert.equal(answer.answerText, "已有完整回答");
        assert.equal(answer.recordingId, recordingId);
        assert.equal(answer.revealedQuestionText, true);
      });

      await t.test("qa/end 拒绝无效问题且不结束 Session", async () => {
        const session = await createSession("qa-end-invalid", "QAING");
        const result = await post(`/training/${session.id}/qa/end`, {
          questionId: `${session.id}-missing`,
          answerText: "should not save",
        });
        assert.equal(result.response.status, 404);
        assert.equal(
          (await prisma.trainingSession.findUniqueOrThrow({ where: { id: session.id } }))
            .status,
          "QAING",
        );
      });

      await t.test("有录音但缺少 Transcript 时报告自动补建持久任务", async () => {
        const session = await createSession("missing-transcript", "QA_ENDED");
        await prisma.trainingSession.update({
          where: { id: session.id },
          data: { qaEndedAt: new Date() },
        });
        const questionId = `${session.id}-q1`;
        const recordingId = `${session.id}-recording`;
        await prisma.trainingQuestion.create({
          data: {
            id: questionId,
            sessionId: session.id,
            projectId,
            orderIndex: 1,
            questionText: "需要转写的问题",
          },
        });
        await prisma.trainingRecording.create({
          data: {
            id: recordingId,
            sessionId: session.id,
            projectId,
            phase: "QA",
            fileName: "fixture.webm",
            filePath: "uploads/training/fixture.webm",
            mimeType: "audio/webm",
            sizeBytes: 1,
          },
        });
        await prisma.trainingAnswer.create({
          data: {
            sessionId: session.id,
            questionId,
            recordingId,
            startedAt: new Date(),
          },
        });

        const response = await fetch(
          `${baseUrl}/training/${session.id}/report/status`,
          { cache: "no-store" },
        );
        const body = await response.json();
        assert.equal(response.status, 200);
        assert.equal(body.qaTranscriptMissingCount, 0);
        assert.equal(body.qaTranscriptCompletedCount, 0);
        assert.ok(
          ["PENDING", "PROCESSING", "FAILED"].includes(
            body.qaTranscriptItems[0]?.transcriptStatus,
          ),
        );

        const jobKey = `training-transcription:${recordingId}`;
        let job = null;
        for (let attempt = 0; attempt < 20; attempt += 1) {
          job = await prisma.asyncJob.findUnique({ where: { jobKey } });
          if (job?.status === "FAILED") break;
          await new Promise((resolve) => setTimeout(resolve, 25));
        }
        assert.equal(job?.jobType, "TRAINING_TRANSCRIPTION");
        assert.equal(job?.status, "FAILED");
        assert.equal(
          (
            await prisma.trainingTranscript.findUniqueOrThrow({
              where: { recordingId },
            })
          ).status,
          "FAILED",
        );
      });

      await t.test("项目材料并发重试只创建一个文件记录", async () => {
        const uploadKey = `${prefix}:material-upload`;
        const makeRequest = () => {
          const formData = new FormData();
          formData.append(
            "file",
            new Blob(["%PDF-1.4\n%%EOF"], { type: "application/pdf" }),
            "idempotent.pdf",
          );
          formData.append("idempotencyKey", uploadKey);
          return fetch(`${baseUrl}/projects/${projectId}/files`, {
            method: "POST",
            headers: { "Idempotency-Key": uploadKey },
            body: formData,
            redirect: "manual",
          });
        };

        const responses = await Promise.all([makeRequest(), makeRequest()]);
        assert.ok(responses.every((response) => response.status === 303));
        const files = await prisma.fileAsset.findMany({
          where: { projectId, uploadKey },
        });
        assert.equal(files.length, 1);
        const materialDirectory = path.dirname(path.resolve(files[0].filePath));
        const materialEntries = await readdir(materialDirectory, {
          withFileTypes: true,
        });
        assert.equal(
          materialEntries.filter((entry) => entry.isFile()).length,
          1,
        );
        await prisma.fileAsset.delete({ where: { id: files[0].id } });
        await rm(path.resolve(files[0].filePath), { force: true });
      });

      await t.test("录音幂等键处理并发和状态变化后的响应重试", async () => {
        const session = await createSession("recording-idempotency", "QAING");
        const uploadKey = `${prefix}:recording-upload`;
        const missingKeyResponse = await fetch(
          `${baseUrl}/training/${session.id}/recordings`,
          { method: "POST" },
        );
        assert.equal(missingKeyResponse.status, 400);
        const makeRequest = (withBody = true) => {
          const options = {
            method: "POST",
            headers: { "Idempotency-Key": uploadKey },
          };
          if (withBody) {
            options.headers = {
              ...options.headers,
              "Content-Type": "audio/webm",
              "X-Recording-Upload": "raw-v1",
              "X-Recording-Phase": "QA",
              "X-Recording-Name": encodeURIComponent("answer.webm"),
              "X-Recording-Ended-At": new Date().toISOString(),
            };
            options.body = new Blob(["recording"], { type: "audio/webm" });
          }
          return fetch(`${baseUrl}/training/${session.id}/recordings`, options);
        };

        const responses = await Promise.all([makeRequest(), makeRequest()]);
        const bodies = await Promise.all(responses.map((response) => response.json()));
        assert.ok(responses.every((response) => response.status === 200));
        assert.equal(bodies[0].recording.id, bodies[1].recording.id);
        assert.equal(
          await prisma.trainingRecording.count({
            where: { sessionId: session.id, uploadKey },
          }),
          1,
        );

        await prisma.trainingSession.update({
          where: { id: session.id },
          data: { status: "QA_ENDED", qaEndedAt: new Date() },
        });
        const replay = await makeRequest(false);
        const replayBody = await replay.json();
        assert.equal(replay.status, 200);
        assert.equal(replayBody.idempotentReplay, true);
        assert.equal(replayBody.recording.id, bodies[0].recording.id);

        const recording = await prisma.trainingRecording.findUniqueOrThrow({
          where: { id: bodies[0].recording.id },
        });
        const recordingEntries = await readdir(
          path.dirname(path.resolve(recording.filePath)),
          { withFileTypes: true },
        );
        assert.equal(
          recordingEntries.filter((entry) => entry.isFile()).length,
          1,
        );
        await prisma.trainingRecording.delete({ where: { id: recording.id } });
        await rm(path.resolve(recording.filePath), { force: true });
      });

      await t.test("手工转写递增 revision，旧 ASR 结果无法覆盖", async () => {
        const session = await createSession("manual-transcript", "QAING");
        const recordingId = `${session.id}-recording`;
        await prisma.trainingRecording.create({
          data: {
            id: recordingId,
            sessionId: session.id,
            projectId,
            phase: "QA",
            fileName: "fixture.webm",
            filePath: "uploads/training/fixture.webm",
            mimeType: "audio/webm",
            sizeBytes: 1,
            transcript: {
              create: {
                sessionId: session.id,
                projectId,
                status: "PROCESSING",
                source: "ASR_PROVIDER",
                text: "",
                revision: 1,
              },
            },
          },
        });

        const manual = await post(
          `/training/${session.id}/recordings/${recordingId}/transcript`,
          { text: "用户确认的手工转写", source: "MANUAL" },
        );
        assert.equal(manual.response.status, 200);
        const staleWrite = await prisma.trainingTranscript.updateMany({
          where: {
            recordingId,
            revision: 1,
            status: "PROCESSING",
            source: "ASR_PROVIDER",
          },
          data: { text: "迟到的 ASR 文本", status: "COMPLETED" },
        });
        assert.equal(staleWrite.count, 0);
        const transcript = await prisma.trainingTranscript.findUniqueOrThrow({
          where: { recordingId },
        });
        assert.equal(transcript.text, "用户确认的手工转写");
        assert.equal(transcript.source, "MANUAL");
        assert.equal(transcript.revision, 2);
      });

      await t.test("历史报告在输入未变化时自动回填且预览更新不会使其过期", async () => {
        const session = await createSession("legacy-report", "QA_ENDED");
        await prisma.trainingSession.update({
          where: { id: session.id },
          data: {
            pitchStartedAt: new Date(Date.now() - 60_000),
            pitchEndedAt: new Date(),
            pitchDurationSec: 60,
            qaEndedAt: new Date(),
          },
        });
        const fileId = `${session.id}-file`;
        await prisma.fileAsset.create({
          data: {
            id: fileId,
            projectId,
            originalName: "legacy.pptx",
            fileType: "pptx",
            filePath: "uploads/legacy.pptx",
            fileSize: 1,
            extractedText: "历史报告使用的材料正文",
            parseStatus: "SUCCESS",
          },
        });
        const legacyAnalysis = await prisma.trainingAnalysis.create({
          data: {
            sessionId: session.id,
            projectId,
            status: "COMPLETED",
            analysisType: "PITCH",
            durationSec: 60,
            summary: "历史报告",
            strengthsJson: "[]",
            weaknessesJson: "[]",
            suggestionsJson: "[]",
            coverageJson: "[]",
            timingJson: "{}",
            slideSyncJson: "{}",
            riskQuestionsJson: "[]",
            rawResultJson: "{}",
            inputHash: "",
          },
        });

        await prisma.fileAsset.update({
          where: { id: fileId },
          data: { previewStatus: "READY", previewPdfPath: "previews/legacy.pdf" },
        });
        const firstStatus = await fetch(
          `${baseUrl}/training/${session.id}/report/status`,
          { cache: "no-store" },
        );
        const firstBody = await firstStatus.json();
        assert.equal(firstStatus.status, 200);
        assert.equal(firstBody.hasStaleAnalysis, false);

        const backfilled = await prisma.trainingAnalysis.findUniqueOrThrow({
          where: { id: legacyAnalysis.id },
        });
        assert.match(backfilled.inputHash, /^v3:[a-f0-9]{64}$/);
        assert.equal(backfilled.promptVersion, "legacy-unknown");
        assert.equal(backfilled.schemaVersion, "legacy-unknown");
        assert.equal(backfilled.modelVersion, "legacy-unknown");
        assert.equal(backfilled.ruleVersion, "legacy-unknown");

        await prisma.fileAsset.update({
          where: { id: fileId },
          data: { previewStatus: "FAILED", previewError: "preview-only change" },
        });
        const previewOnlyStatus = await fetch(
          `${baseUrl}/training/${session.id}/report/status`,
          { cache: "no-store" },
        );
        assert.equal((await previewOnlyStatus.json()).hasStaleAnalysis, false);

        await prisma.trainingSession.update({
          where: { id: session.id },
          data: { currentPageIndex: 2 },
        });
        const changedStatus = await fetch(
          `${baseUrl}/training/${session.id}/report/status`,
          { cache: "no-store" },
        );
        assert.equal((await changedStatus.json()).hasStaleAnalysis, true);
      });

      await t.test("报告使用输入指纹且重新生成不覆盖旧版本", async () => {
        const session = await createSession("analysis-revisions", "QA_ENDED");
        await prisma.trainingSession.update({
          where: { id: session.id },
          data: {
            pitchStartedAt: new Date(Date.now() - 60_000),
            pitchEndedAt: new Date(),
            pitchDurationSec: 60,
            qaEndedAt: new Date(),
          },
        });

        const first = await post(`/training/${session.id}/analysis`);
        assert.equal(first.response.status, 200);
        const firstAnalysis = await prisma.trainingAnalysis.findUniqueOrThrow({
          where: { id: first.body.analysis.id },
        });
        assert.equal(firstAnalysis.status, "COMPLETED");
        assert.match(firstAnalysis.inputHash, /^v3:[a-f0-9]{64}$/);
        assert.match(
          firstAnalysis.promptVersion,
          /^pitch-performance-analysis:/,
        );
        assert.match(firstAnalysis.schemaVersion, /^training-analysis-result:/);
        assert.ok(firstAnalysis.modelVersion);
        assert.match(firstAnalysis.ruleVersion, /^pitch-analysis-policy:/);
        assert.equal(
          (
            await prisma.trainingSession.findUniqueOrThrow({
              where: { id: session.id },
            })
          ).currentAnalysisId,
          firstAnalysis.id,
        );

        await prisma.trainingSession.update({
          where: { id: session.id },
          data: { currentPageIndex: 2 },
        });
        const statusResponse = await fetch(
          `${baseUrl}/training/${session.id}/report/status`,
          { cache: "no-store" },
        );
        const statusBody = await statusResponse.json();
        assert.equal(statusBody.hasStaleAnalysis, true);

        const second = await post(`/training/${session.id}/analysis`);
        assert.equal(second.response.status, 200);
        assert.notEqual(second.body.analysis.id, first.body.analysis.id);
        assert.equal(
          await prisma.trainingAnalysis.count({
            where: { sessionId: session.id, status: "COMPLETED" },
          }),
          2,
        );
        assert.equal(
          (
            await prisma.trainingAnalysis.findUniqueOrThrow({
              where: { id: first.body.analysis.id },
            })
          ).status,
          "COMPLETED",
        );
        assert.equal(
          (
            await prisma.trainingSession.findUniqueOrThrow({
              where: { id: session.id },
            })
          ).currentAnalysisId,
          second.body.analysis.id,
        );
      });
    } finally {
      await prisma.trainingSession.deleteMany({ where: { id: { in: sessionIds } } });
      await prisma.project.deleteMany({ where: { id: projectId } });
      await prisma.user.deleteMany({ where: { id: userId } });
      await prisma.$disconnect();
    }
  },
);
