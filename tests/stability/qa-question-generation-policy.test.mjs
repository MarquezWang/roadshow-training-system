import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";

const source = await readFile(
  new URL("../../lib/qa-question-generation/policy.ts", import.meta.url),
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
  appendDynamicFollowupQuestion,
  canAttemptDynamicFollowupPhase,
  canScheduleDynamicFollowupRetry,
  DYNAMIC_FOLLOWUP_MAX_RETRY_COUNT,
  DYNAMIC_FOLLOWUP_RETRY_DELAY_MS,
  getProtectedQuestionIds,
  getQaGenerationMaxWaitMs,
  isDynamicFollowupQuestion,
  isTranscriptNotReadyReason,
  QA_GENERATION_POLL_INTERVAL_MS,
  QA_GENERATION_WAIT_HINT_MS,
} = await import(moduleUrl);

function question(id, overrides = {}) {
  return {
    id,
    orderIndex: 1,
    questionText: `问题 ${id}`,
    questionType: "GENERAL",
    source: "AI",
    basis: null,
    answer: null,
    ...overrides,
  };
}

function answer(overrides = {}) {
  return {
    id: "answer-1",
    answerText: null,
    revealedQuestionText: false,
    startedAt: null,
    endedAt: null,
    durationSec: null,
    ...overrides,
  };
}

test("QA 生成等待窗口和轮询节奏保持实验开关边界", () => {
  assert.equal(getQaGenerationMaxWaitMs(false), 60_000);
  assert.equal(getQaGenerationMaxWaitMs(true), 120_000);
  assert.equal(QA_GENERATION_POLL_INTERVAL_MS, 3_000);
  assert.equal(QA_GENERATION_WAIT_HINT_MS, 30_000);
});

test("动态追问只在 QA 未结束且未耗尽重试次数时继续", () => {
  assert.equal(DYNAMIC_FOLLOWUP_RETRY_DELAY_MS, 3_000);
  assert.equal(DYNAMIC_FOLLOWUP_MAX_RETRY_COUNT, 10);
  assert.equal(canAttemptDynamicFollowupPhase("READY"), true);
  assert.equal(canAttemptDynamicFollowupPhase("ANSWERING"), true);
  assert.equal(canAttemptDynamicFollowupPhase("DONE"), false);
  assert.equal(canScheduleDynamicFollowupRetry("READY", 9), true);
  assert.equal(canScheduleDynamicFollowupRetry("READY", 10), false);
  assert.equal(canScheduleDynamicFollowupRetry("DONE", 0), false);
});

test("动态追问识别兼容来源字段和问题类型字段", () => {
  assert.equal(
    isDynamicFollowupQuestion(
      question("source", { source: "DYNAMIC_FOLLOWUP" }),
    ),
    true,
  );
  assert.equal(
    isDynamicFollowupQuestion(
      question("type", { questionType: "FOLLOWUP" }),
    ),
    true,
  );
  assert.equal(isDynamicFollowupQuestion(question("base")), false);
  assert.equal(isDynamicFollowupQuestion(null), false);
});

test("转写尚未就绪原因允许重试，其他跳过原因终止", () => {
  for (const reason of [
    "dynamic_followup_in_progress",
    "pitch_transcript_not_ready",
    "TRANSCRIPT_NOT_READY",
    "no_pitch_transcript",
    "pitch transcript missing",
  ]) {
    assert.equal(isTranscriptNotReadyReason(reason), true, reason);
  }

  for (const reason of [
    undefined,
    "",
    "transcript_completed",
    "insufficient_pitch_content",
  ]) {
    assert.equal(isTranscriptNotReadyReason(reason), false, String(reason));
  }
});

test("已展示或已开始回答的问题会进入动态追问保护列表", () => {
  const questions = [
    question("untouched"),
    question("empty-answer", { answer: answer() }),
    question("revealed", {
      answer: answer({ revealedQuestionText: true }),
    }),
    question("started", {
      answer: answer({ startedAt: "2026-01-01T00:00:00.000Z" }),
    }),
    question("ended", {
      answer: answer({ endedAt: "2026-01-01T00:00:10.000Z" }),
    }),
  ];

  assert.deepEqual(getProtectedQuestionIds(questions), [
    "revealed",
    "started",
    "ended",
  ]);
});

test("动态追问按题序插入，并按 ID 或动态题位幂等去重", () => {
  const currentQuestions = [
    question("q1", { orderIndex: 1 }),
    question("q3", { orderIndex: 3 }),
  ];
  const dynamicQuestion = question("q2-dynamic", {
    orderIndex: 2,
    questionType: "FOLLOWUP",
    source: "DYNAMIC_FOLLOWUP",
  });
  const appended = appendDynamicFollowupQuestion(
    currentQuestions,
    dynamicQuestion,
  );

  assert.deepEqual(
    appended.map((item) => item.id),
    ["q1", "q2-dynamic", "q3"],
  );
  assert.deepEqual(
    currentQuestions.map((item) => item.id),
    ["q1", "q3"],
  );
  assert.equal(
    appendDynamicFollowupQuestion(appended, dynamicQuestion),
    appended,
  );
  assert.equal(
    appendDynamicFollowupQuestion(
      appended,
      question("replacement", {
        orderIndex: 2,
        questionType: "FOLLOWUP",
        source: "DYNAMIC_FOLLOWUP",
      }),
    ),
    appended,
  );
});
