import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";

const source = await readFile(
  new URL(
    "../../app/training/[sessionId]/qa/training-qa/training-qa-flow.ts",
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
const { findInitialQaQuestionIndex, getQaProgression } = await import(
  moduleUrl
);

function question(id, overrides = {}) {
  return {
    id,
    orderIndex: 0,
    questionText: `问题 ${id}`,
    questionType: "BASE",
    source: "GENERATED",
    basis: null,
    answer: null,
    ...overrides,
  };
}

function completedAnswer(id) {
  return {
    id: `answer-${id}`,
    answerText: "已回答",
    revealedQuestionText: false,
    startedAt: "2026-01-01T00:00:00.000Z",
    endedAt: "2026-01-01T00:00:10.000Z",
    durationSec: 10,
  };
}

test("QA 恢复时定位首个未完成问题，全部完成时停在最后一题", () => {
  const questions = [
    question("completed", { answer: completedAnswer("completed") }),
    question("pending"),
    question("later"),
  ];

  assert.equal(findInitialQaQuestionIndex(questions), 1);
  assert.equal(
    findInitialQaQuestionIndex(
      questions.map((item) => ({
        ...item,
        answer: completedAnswer(item.id),
      })),
    ),
    2,
  );
});

test("基础题时间不足时优先跳到尚未完成的动态追问", () => {
  const progression = getQaProgression(
    [
      question("current"),
      question("next-base"),
      question("followup", {
        questionType: "FOLLOWUP",
        source: "DYNAMIC_FOLLOWUP",
      }),
    ],
    0,
    30,
  );

  assert.equal(progression.nextDynamicFollowupIndex, 2);
  assert.equal(progression.shouldSkipToDynamicFollowup, true);
  assert.equal(progression.shouldFinishAfterCurrent, false);
});

test("基础题时间不足且只有后续基础题时结束问答", () => {
  const progression = getQaProgression(
    [question("current"), question("next-base")],
    0,
    30,
  );

  assert.equal(progression.nextDynamicFollowupIndex, -1);
  assert.equal(progression.shouldSkipToDynamicFollowup, false);
  assert.equal(progression.shouldFinishAfterCurrent, true);
});

test("动态追问回答后结束问答", () => {
  const progression = getQaProgression(
    [
      question("followup", {
        questionType: "FOLLOWUP",
        source: "DYNAMIC_FOLLOWUP",
      }),
      question("next-base"),
    ],
    0,
    60,
  );

  assert.equal(progression.isCurrentDynamicFollowup, true);
  assert.equal(progression.shouldFinishAfterCurrent, true);
});

test("基础题时间充足时继续正常题序", () => {
  const progression = getQaProgression(
    [question("current"), question("next-base")],
    0,
    31,
  );

  assert.equal(progression.shouldSkipToDynamicFollowup, false);
  assert.equal(progression.shouldFinishAfterCurrent, false);
});
