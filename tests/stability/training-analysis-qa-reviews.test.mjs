import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";

const source = await readFile(
  new URL("../../lib/training-analysis-qa-reviews.ts", import.meta.url),
  "utf8",
);
const transpiled = ts.transpileModule(source, {
  compilerOptions: {
    module: ts.ModuleKind.ESNext,
    target: ts.ScriptTarget.ES2022,
  },
}).outputText;
const moduleUrl = `data:text/javascript;base64,${Buffer.from(transpiled).toString("base64")}`;
const { normalizeTrainingAnalysisQaReviews } = await import(moduleUrl);

function question(overrides) {
  return {
    questionId: "question-1",
    orderIndex: 1,
    questionType: "BASE",
    source: "GENERATED",
    questionText: "项目的核心优势是什么？",
    answerDurationSec: 10,
    answerText: null,
    transcribeText: "我们的优势是验证速度。",
    transcribeStatus: "COMPLETED",
    transcribeFailed: false,
    transcribePending: false,
    transcribeNote: null,
    ...overrides,
  };
}

test("QA review 归一化补齐缺失回答与转写等待状态", () => {
  const analysis = normalizeTrainingAnalysisQaReviews(
    { qaReviews: [] },
    [
      question({
        questionId: "missing-answer",
        answerDurationSec: null,
        transcribeText: null,
        transcribeStatus: null,
      }),
      question({
        questionId: "pending-transcript",
        transcribeText: null,
        transcribeStatus: "PROCESSING",
        transcribePending: true,
      }),
    ],
  );

  assert.equal(analysis.qaReviews.length, 2);
  assert.deepEqual(
    analysis.qaReviews.map((review) => ({
      questionId: review.questionId,
      responseQuality: review.responseQuality,
      responseQualityLabel: review.responseQualityLabel,
    })),
    [
      {
        questionId: "missing-answer",
        responseQuality: "WEAK",
        responseQualityLabel: "回答缺失或偏弱",
      },
      {
        questionId: "pending-transcript",
        responseQuality: "WEAK",
        responseQualityLabel: "转写超时，分析依据不足",
      },
    ],
  );
});

test("无效回答会降为 WEAK，同时保留已有的具体复盘内容", () => {
  const existingReview = {
    questionId: "question-1",
    questionIndex: 1,
    dimension: "OTHER",
    question: "项目的核心优势是什么？",
    judgeIntent: "确认竞争壁垒。",
    answerSummary: "已有摘要",
    responseQuality: "GOOD",
    responseQualityLabel: "回答充分",
    missingPoints: ["缺少量化对比"],
    evidenceUse: "引用了试点结果。",
    improvementAdvice: "补充竞品数据。",
    betterAnswerOutline: ["先给结论", "再给数据"],
  };
  const analysis = normalizeTrainingAnalysisQaReviews(
    { qaReviews: [existingReview] },
    [
      question({
        answerDurationSec: null,
        transcribeText: null,
        transcribeStatus: null,
      }),
    ],
  );

  assert.equal(analysis.qaReviews.length, 1);
  assert.equal(analysis.qaReviews[0].responseQuality, "WEAK");
  assert.equal(analysis.qaReviews[0].responseQualityLabel, "回答缺失或偏弱");
  assert.equal(analysis.qaReviews[0].answerSummary, "已有摘要");
  assert.deepEqual(analysis.qaReviews[0].missingPoints, ["缺少量化对比"]);
  assert.deepEqual(analysis.qaReviews[0].betterAnswerOutline, [
    "先给结论",
    "再给数据",
  ]);
});
