import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";

function transpileToDataUrl(source) {
  const transpiled = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.ESNext,
      target: ts.ScriptTarget.ES2022,
    },
  }).outputText;
  return `data:text/javascript;base64,${Buffer.from(transpiled).toString("base64")}`;
}

async function importTypeScriptModule(relativePath) {
  const source = await readFile(new URL(relativePath, import.meta.url), "utf8");
  return import(transpileToDataUrl(source));
}

const reactHooksStubUrl = transpileToDataUrl(`
  export function useCallback(callback) { return callback; }
  export function useEffect(effect) { effect(); }
`);
const requestModuleUrl = transpileToDataUrl(
  await readFile(
    new URL(
      "../../app/training/[sessionId]/qa/training-qa/training-qa-request.ts",
      import.meta.url,
    ),
    "utf8",
  ),
);
const countdownSource = (
  await readFile(
    new URL(
      "../../app/training/[sessionId]/qa/training-qa/use-training-qa-countdown.ts",
      import.meta.url,
    ),
    "utf8",
  )
).replace('from "react"', `from "${reactHooksStubUrl}"`);
const persistenceSource = (
  await readFile(
    new URL(
      "../../app/training/[sessionId]/qa/training-qa/use-training-qa-persistence.ts",
      import.meta.url,
    ),
    "utf8",
  )
)
  .replace('from "react"', `from "${reactHooksStubUrl}"`)
  .replace(
    'from "./training-qa-request"',
    `from "${requestModuleUrl}"`,
  );
const countdown = await import(transpileToDataUrl(countdownSource));
const persistence = await import(transpileToDataUrl(persistenceSource));

const { findInitialQaQuestionIndex, getQaProgression } =
  await importTypeScriptModule(
    "../../app/training/[sessionId]/qa/training-qa/training-qa-flow.ts",
  );
const {
  DYNAMIC_FOLLOWUP_ANSWER_LIMIT_SEC,
  getCurrentQuestionTiming,
  getCurrentUsedAnswerSec,
  getInitialUsedAnswerSec,
  getSessionQaDurationSec,
  QA_LIMIT_SEC,
} = await importTypeScriptModule(
  "../../app/training/[sessionId]/qa/training-qa/training-qa-timing.ts",
);
const { buildQaAnswerRequestBody, buildQaEndRequestBody } =
  await importTypeScriptModule(
    "../../app/training/[sessionId]/qa/training-qa/training-qa-request.ts",
  );
const { createQuestionStartCoordinator } = await importTypeScriptModule(
  "../../app/training/[sessionId]/qa/training-qa/training-qa-question-start.ts",
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

test("QA 初始已用时间沿用剩余时间换算边界", () => {
  assert.equal(QA_LIMIT_SEC, 180);
  assert.equal(DYNAMIC_FOLLOWUP_ANSWER_LIMIT_SEC, 60);
  assert.equal(getInitialUsedAnswerSec(180), 0);
  assert.equal(getInitialUsedAnswerSec(75), 105);
  assert.equal(getInitialUsedAnswerSec(999), 0);
  assert.equal(getInitialUsedAnswerSec(-10), 190);
});

test("当前题计时区分基础题和动态追问", () => {
  assert.deepEqual(getCurrentQuestionTiming(false, 42, 9), {
    limitSec: 180,
    remainingSec: 138,
    usedSec: 42,
  });
  assert.deepEqual(getCurrentQuestionTiming(true, 42, 9), {
    limitSec: 60,
    remainingSec: 51,
    usedSec: 9,
  });
});

test("回答阶段按整秒累计且保持上限和恢复基数", () => {
  assert.equal(
    getCurrentUsedAnswerSec({
      isDynamicFollowup: false,
      qaPhase: "ANSWERING",
      phaseStartedMs: 10_000,
      elapsedBeforePhaseSec: 40,
      usedAnswerSec: 40,
      dynamicFollowupUsedSec: 0,
      nowMs: 12_999,
    }),
    42,
  );
  assert.equal(
    getCurrentUsedAnswerSec({
      isDynamicFollowup: false,
      qaPhase: "ANSWERING",
      phaseStartedMs: 10_000,
      elapsedBeforePhaseSec: 179,
      usedAnswerSec: 179,
      dynamicFollowupUsedSec: 0,
      nowMs: 20_000,
    }),
    180,
  );
  assert.equal(
    getCurrentUsedAnswerSec({
      isDynamicFollowup: false,
      qaPhase: "ASKING",
      phaseStartedMs: 10_000,
      elapsedBeforePhaseSec: 40,
      usedAnswerSec: 45,
      dynamicFollowupUsedSec: 0,
      nowMs: 20_000,
    }),
    45,
  );
});

test("动态追问独立计时并计入会话总时长", () => {
  const dynamicUsedSec = getCurrentUsedAnswerSec({
    isDynamicFollowup: true,
    qaPhase: "ANSWERING",
    phaseStartedMs: 10_000,
    elapsedBeforePhaseSec: 170,
    usedAnswerSec: 170,
    dynamicFollowupUsedSec: 0,
    nowMs: 80_000,
  });

  assert.equal(dynamicUsedSec, 60);
  assert.equal(getSessionQaDurationSec(true, 170, dynamicUsedSec), 230);
  assert.equal(getSessionQaDurationSec(false, 170, 175), 175);
});

test("QA 结束请求体保留可选字段和文本揭示状态", () => {
  assert.deepEqual(
    buildQaEndRequestBody({
      qaDurationSec: 91,
      questionId: "question-1",
      recordingId: "recording-1",
      revealedQuestionText: true,
    }),
    {
      questionId: "question-1",
      revealedQuestionText: true,
      recordingId: "recording-1",
      qaDurationSec: 91,
    },
  );
});

test("保存回答请求体显式传递完成和目标题策略", () => {
  assert.deepEqual(
    buildQaAnswerRequestBody({
      finish: false,
      preferredNextQuestionId: "dynamic-question",
      qaDurationSec: 120,
      recordingId: undefined,
      revealedQuestionText: false,
    }),
    {
      revealedQuestionText: false,
      recordingId: undefined,
      qaDurationSec: 120,
      finish: false,
      preferredNextQuestionId: "dynamic-question",
    },
  );
});

test("题目开始请求按题复用，失败后允许重新发起", async () => {
  let resolveFirst;
  const calls = [];
  const coordinator = createQuestionStartCoordinator(async (questionId) => {
    calls.push(questionId);
    if (calls.length === 1) {
      await new Promise((resolve) => {
        resolveFirst = resolve;
      });
      return;
    }
    if (calls.length === 2) throw new Error("temporary failure");
  });

  const first = coordinator.ensureStarted("question-1");
  assert.equal(coordinator.ensureStarted("question-1"), first);
  assert.deepEqual(calls, ["question-1"]);
  resolveFirst();
  await first;
  assert.equal(coordinator.ensureStarted("question-1"), first);

  await assert.rejects(
    coordinator.ensureStarted("question-2"),
    /temporary failure/,
  );
  await Promise.resolve();
  await coordinator.ensureStarted("question-2");
  assert.deepEqual(calls, ["question-1", "question-2", "question-2"]);
});

test("服务端单题计时只在进入 ANSWERING 时启动，录音无需等待网络", async () => {
  let resolveStart;
  const events = [];
  const beginPreAnswerCountdownRef = { current: null };
  const hook = countdown.useTrainingQaCountdown({
    answerElapsedBeforePhaseRef: { current: 0 },
    answerPhaseStartedMsRef: { current: null },
    beginPreAnswerCountdownRef,
    cancelSpeech: () => events.push("cancel-speech"),
    clearSpeechTimer: () => {},
    countdownIntervalRef: { current: null },
    currentQuestion: question("question-1"),
    markQuestionStarted: async () => {
      events.push("start-requested");
      await new Promise((resolve) => {
        resolveStart = resolve;
      });
      events.push("start-recorded");
    },
    setDynamicFollowupUsedSec: () => {},
    setPreAnswerOverlay: () => {},
    setQaPhase: (phase) => events.push(`phase:${phase}`),
    setUsedAnswerSec: () => {},
    startQuestionRecording: async () => events.push("recording-started"),
    usedAnswerSec: 0,
  });

  assert.deepEqual(events, []);
  await hook.beginAnswering();
  assert.deepEqual(events, [
    "start-requested",
    "phase:ANSWERING",
    "cancel-speech",
    "recording-started",
  ]);
  resolveStart();
  await Promise.resolve();
  assert.equal(events.at(-1), "start-recorded");

  const questionFlowSource = await readFile(
    new URL(
      "../../app/training/[sessionId]/qa/training-qa/use-training-qa-question-flow.ts",
      import.meta.url,
    ),
    "utf8",
  );
  assert.doesNotMatch(questionFlowSource, /markQuestionStarted/);
});

test("保存答案会等待延迟的开始请求完成", async () => {
  let resolveStart;
  const events = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => {
    events.push("answer-submitted");
    return {
      ok: true,
      json: async () => ({ completed: true }),
    };
  };

  try {
    const hook = persistence.useTrainingQaPersistence({
      answerElapsedBeforePhaseRef: { current: 0 },
      beginJudgeQuestion: () => {},
      cancelSpeech: () => {},
      clearCountdownTimer: () => {},
      clearSpeechTimer: () => {},
      currentQuestion: question("question-1"),
      currentQuestionIndex: 0,
      getCurrentUsedAnswerSec: () => 12,
      getSessionQaDurationSec: () => 12,
      hasAutoEndedRef: { current: false },
      isCompletingNormallyRef: { current: false },
      markQuestionStarted: async () => {
        events.push("start-requested");
        await new Promise((resolve) => {
          resolveStart = resolve;
        });
        events.push("start-recorded");
      },
      navigateToReport: () => events.push("navigated"),
      qaPhase: "ANSWERING",
      questions: [question("question-1")],
      revealedQuestionIds: new Set(),
      sessionId: "session-1",
      setIsSaving: () => {},
      setMessage: () => {},
      setQaPhase: () => {},
      setQuestions: () => {},
      setUsedAnswerSec: () => {},
      shouldFinishAfterCurrent: true,
      stopAndUploadCurrentRecording: async () => {
        events.push("recording-stopped");
        return null;
      },
    });

    const saving = hook.saveAndContinue();
    await new Promise((resolve) => setImmediate(resolve));
    assert.deepEqual(events, ["start-requested"]);

    resolveStart();
    await saving;
    assert.deepEqual(events, [
      "start-requested",
      "start-recorded",
      "recording-stopped",
      "answer-submitted",
      "navigated",
    ]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
