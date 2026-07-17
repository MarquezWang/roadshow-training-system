import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";

const source = await readFile(
  new URL(
    "../../app/training/[sessionId]/qa/questions/dynamic-followup/dynamic-followup-response.ts",
    import.meta.url,
  ),
  "utf8",
);
const transpiled = ts.transpileModule(source, {
  compilerOptions: {
    module: ts.ModuleKind.ESNext,
    target: ts.ScriptTarget.ES2022,
  },
}).outputText;
const moduleUrl = `data:text/javascript;base64,${Buffer.from(transpiled).toString("base64")}`;
const {
  buildDynamicFollowupDebugResponse,
  buildDynamicFollowupSkippedSuccessResponse,
  buildDynamicFollowupSuccessResponse,
  buildDynamicFollowupUnexpectedFailureResponse,
} = await import(moduleUrl);

const debugInfo = {
  validationReason: "fixture_reason",
  pitchTextLength: 120,
};

test("动态追问调试信息只在显式开启 debug 时返回", () => {
  assert.deepEqual(
    buildDynamicFollowupDebugResponse(false, debugInfo, {
      reason: "pitch_transcript_not_ready",
    }),
    {
      ok: false,
      skipped: true,
      reason: "pitch_transcript_not_ready",
    },
  );
  assert.deepEqual(
    buildDynamicFollowupDebugResponse(true, debugInfo, {
      reason: "pitch_transcript_not_ready",
    }),
    {
      ok: false,
      skipped: true,
      reason: "pitch_transcript_not_ready",
      debug: debugInfo,
    },
  );
});

test("预检主动跳过保持成功响应语义", () => {
  assert.deepEqual(
    buildDynamicFollowupSkippedSuccessResponse(
      false,
      debugInfo,
      "insufficient_project_pitch_content",
    ),
    {
      ok: true,
      skipped: true,
      reason: "insufficient_project_pitch_content",
    },
  );
});

test("创建成功响应保留完整问题与兼容字段", () => {
  const question = {
    id: "question-4",
    orderIndex: 4,
    questionText: "你会如何验证当前方案的实际效果？",
    questionType: "FOLLOWUP",
    source: "DYNAMIC_FOLLOWUP",
    basis: "基于本轮 Pitch 转写生成的动态追问",
    answer: null,
  };

  assert.deepEqual(
    buildDynamicFollowupSuccessResponse(false, debugInfo, question),
    {
      ok: true,
      createdQuestion: question,
      createdQuestionId: "question-4",
      orderIndex: 4,
      questionText: "你会如何验证当前方案的实际效果？",
      source: "DYNAMIC_FOLLOWUP",
    },
  );
});

test("意外生成错误继续使用可重试的成功跳过契约", () => {
  assert.deepEqual(
    buildDynamicFollowupUnexpectedFailureResponse(false, debugInfo),
    {
      ok: true,
      skipped: true,
      reason: "ai_generation_failed",
    },
  );
});
