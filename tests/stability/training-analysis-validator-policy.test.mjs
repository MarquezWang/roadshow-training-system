import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";

function transpileToDataUrl(source) {
  const output = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.ESNext,
      target: ts.ScriptTarget.ES2022,
    },
  }).outputText;
  return `data:text/javascript;base64,${Buffer.from(output).toString("base64")}`;
}

async function readSource(relativePath) {
  return readFile(new URL(relativePath, import.meta.url), "utf8");
}

const typeGuardsUrl = transpileToDataUrl(
  await readSource("../../lib/type-guards.ts"),
);
const primitivesUrl = transpileToDataUrl(
  (await readSource("../../lib/training-analysis-validator/primitives.ts")).replace(
    'from "@/lib/type-guards"',
    `from "${typeGuardsUrl}"`,
  ),
);
const coverageUrl = transpileToDataUrl(
  (await readSource("../../lib/training-analysis-validator/coverage.ts"))
    .replace(
      'from "@/lib/type-guards"',
      `from "${typeGuardsUrl}"`,
    )
    .replace('from "./primitives"', `from "${primitivesUrl}"`),
);
const qaReviewsUrl = transpileToDataUrl(
  (await readSource("../../lib/training-analysis-validator/qa-reviews.ts"))
    .replace(
      'from "@/lib/type-guards"',
      `from "${typeGuardsUrl}"`,
    )
    .replace('from "./primitives"', `from "${primitivesUrl}"`),
);
const reportDetailsUrl = transpileToDataUrl(
  (await readSource("../../lib/training-analysis-validator/report-details.ts"))
    .replace(
      'from "@/lib/type-guards"',
      `from "${typeGuardsUrl}"`,
    )
    .replace('from "./primitives"', `from "${primitivesUrl}"`),
);
const validateUrl = transpileToDataUrl(
  (await readSource("../../lib/training-analysis-validator/validate.ts"))
    .replace('from "./primitives"', `from "${primitivesUrl}"`)
    .replace('from "./coverage"', `from "${coverageUrl}"`)
    .replace('from "./qa-reviews"', `from "${qaReviewsUrl}"`)
    .replace(
      'from "./report-details"',
      `from "${reportDetailsUrl}"`,
    ),
);
const { validateTrainingAnalysisResult } = await import(validateUrl);

const coverageItems = [
  "项目背景",
  "痛点问题",
  "技术方案",
  "核心创新",
  "应用场景",
  "市场空间",
  "商业模式",
  "团队能力",
  "融资/合作需求",
];

function validAnalysis(overrides = {}) {
  return {
    overallScore: 70,
    summary: "训练总结",
    strengths: ["优势一"],
    weaknesses: ["短板一", "短板二", "短板三"],
    suggestions: ["建议一"],
    contentCoverage: [],
    timing: { durationSec: 500 },
    slideSync: { pageCount: 10 },
    riskQuestions: ["风险一", "风险二", "风险三"],
    ...overrides,
  };
}

function captureWarnings(callback) {
  const warnings = [];
  const originalWarn = console.warn;
  console.warn = (...args) => warnings.push(args);
  try {
    return { value: callback(), warnings };
  } finally {
    console.warn = originalWarn;
  }
}

test("root object and score validation retain exact failures", () => {
  assert.throws(
    () => validateTrainingAnalysisResult(null),
    /analysisJson 必须是对象。/,
  );

  for (const overallScore of [undefined, -1, 101, 1.5, "not-a-number"]) {
    assert.throws(
      () => validateTrainingAnalysisResult(validAnalysis({ overallScore })),
      /overallScore 必须是 0 到 100 的整数。/,
    );
  }

  assert.equal(
    validateTrainingAnalysisResult(validAnalysis({ overallScore: "88" }))
      .overallScore,
    88,
  );
});

test("required text, arrays, and objects retain field-specific errors", () => {
  for (const [field, value, message] of [
    ["summary", " ", "summary 必须是非空字符串。"],
    ["strengths", null, "strengths 必须是数组。"],
    ["weaknesses", null, "weaknesses 必须是数组。"],
    ["suggestions", null, "suggestions 必须是数组。"],
    ["contentCoverage", null, "contentCoverage 必须是数组。"],
    ["timing", [], "timing 必须是对象。"],
    ["slideSync", null, "slideSync 必须是对象。"],
    ["riskQuestions", null, "riskQuestions 必须是数组。"],
  ]) {
    assert.throws(
      () => validateTrainingAnalysisResult(validAnalysis({ [field]: value })),
      (error) => error instanceof Error && error.message === message,
    );
  }
});

test("core arrays trim, filter, warn, and cap with the existing policy", () => {
  const result = captureWarnings(() =>
    validateTrainingAnalysisResult(
      validAnalysis({
        summary: "  trimmed summary  ",
        strengths: [" a ", null, "b", "c", "d", "e", "f"],
        weaknesses: [" w1 ", "w2"],
        suggestions: [" s1 ", "s2", "s3", "s4", "s5", "s6"],
        nextTrainingTasks: [" t1 ", "t2", "t3", "t4", "t5", "t6"],
        riskQuestions: [" r1 ", "r2", "r3", "r4", "r5", "r6"],
      }),
    ),
  );

  assert.equal(result.value.summary, "trimmed summary");
  assert.deepEqual(result.value.strengths, ["a", "b", "c", "d", "e"]);
  assert.deepEqual(result.value.weaknesses, ["w1", "w2"]);
  assert.deepEqual(result.value.suggestions, ["s1", "s2", "s3", "s4", "s5"]);
  assert.deepEqual(result.value.nextTrainingTasks, ["t1", "t2", "t3", "t4", "t5"]);
  assert.deepEqual(result.value.riskQuestions, ["r1", "r2", "r3", "r4", "r5"]);
  assert.deepEqual(
    result.warnings.map(([message]) => message),
    [
      "[validator] strengths 期望最多 5 条，实际 6 条，已截断。",
      "[validator] weaknesses 期望至少 3 条，实际 2 条，已降级接受。",
      "[validator] suggestions 期望最多 5 条，实际 6 条，已截断。",
      "[validator] nextTrainingTasks 期望最多 5 条，实际 6 条，已截断。",
      "[validator] riskQuestions 期望最多 5 条，实际 6 条，已截断。",
    ],
  );
});

test("coverage output fills nine standard slots while retaining matched labels", () => {
  const result = validateTrainingAnalysisResult(
    validAnalysis({
      contentCoverage: [
        {
          item: "技术",
          covered: "partial",
          evidence: " 技术证据 ",
          suggestion: " 技术建议 ",
        },
        {
          item: "技术方案",
          covered: "true",
          evidence: "后出现的重复项",
          suggestion: "后出现的重复项",
        },
        { item: "市场空间", covered: "INSUFFICIENT" },
        { item: "团队能力", covered: "unknown" },
        null,
      ],
    }),
  );

  assert.deepEqual(result.contentCoverage.map(({ item }) => item), [
    ...coverageItems.slice(0, 2),
    "技术",
    ...coverageItems.slice(3),
  ]);
  assert.deepEqual(result.contentCoverage[2], {
    item: "技术",
    covered: "partial",
    evidence: "技术证据",
    suggestion: "技术建议",
  });
  assert.deepEqual(result.contentCoverage[5], {
    item: "市场空间",
    covered: "INSUFFICIENT",
    evidence: "未在当前材料或转写中提取到充分证据。",
    suggestion: "建议补充该部分内容。",
  });
  assert.equal(result.contentCoverage[7].covered, "false");
  assert.deepEqual(result.contentCoverage[0], {
    item: "项目背景",
    covered: "INSUFFICIENT",
    evidence: "未在当前材料或转写中提取到充分证据。",
    suggestion: "建议补充该部分内容。",
  });
});

test("one-page summary falls back to normalized core fields", () => {
  const result = validateTrainingAnalysisResult(
    validAnalysis({
      summary: "  核心结论  ",
      strengths: [" 最强优势 "],
      weaknesses: [" 最大短板 ", "二", "三"],
      suggestions: [" 下一轮重点 "],
      onePageSummary: {
        conclusion: "",
        strongestPoint: " 自定义优势 ",
        readinessAdvice: null,
      },
    }),
  );

  assert.deepEqual(result.onePageSummary, {
    conclusion: "核心结论",
    strongestPoint: "自定义优势",
    biggestWeakness: "最大短板",
    nextTrainingFocus: "下一轮重点",
    readinessAdvice: "建议完成下一轮针对性训练后再进入正式展示。",
  });
});

test("diagnostics and action items filter invalid entries and keep caps", () => {
  const actionItems = Array.from({ length: 7 }, (_, index) =>
    index === 1
      ? null
      : {
          issue: index === 0 ? " issue " : `issue-${index}`,
          whyItMatters: index === 0 ? "" : `why-${index}`,
          howToFix: index === 0 ? null : `fix-${index}`,
          sampleWording: index === 0 ? " words " : `words-${index}`,
        },
  );
  const result = validateTrainingAnalysisResult(
    validAnalysis({
      diagnostics: {
        content: ["1", "2", "3", "4", "5"],
        delivery: "invalid",
        qa: [" keep spaces ", "", 1],
      },
      actionItems,
    }),
  );

  assert.deepEqual(result.diagnostics, {
    content: ["1", "2", "3", "4"],
    delivery: [],
    qa: [" keep spaces "],
  });
  assert.equal(result.actionItems.length, 5);
  assert.deepEqual(result.actionItems[0], {
    issue: "issue",
    whyItMatters: "该问题会影响评委对项目价值和可信度的判断。",
    howToFix: "建议补充具体证据并重写相关表达。",
    sampleWording: "words",
  });
});

test("qaReviews preserves absent versus empty semantics", () => {
  assert.equal(validateTrainingAnalysisResult(validAnalysis()).qaReviews, undefined);
  assert.equal(
    validateTrainingAnalysisResult(validAnalysis({ qaReviews: {} })).qaReviews,
    undefined,
  );
  assert.deepEqual(
    validateTrainingAnalysisResult(validAnalysis({ qaReviews: [] })).qaReviews,
    [],
  );
});

test("qaReviews normalizes aliases, qualities, defaults, and string lists", () => {
  const result = validateTrainingAnalysisResult(
    validAnalysis({
      qaReviews: [
        null,
        {
          dimension: "技术可行性",
          responseQuality: " good ",
          missingPoints: [" keep spaces ", "", 1],
          betterAnswerOutline: [" outline "],
        },
        {
          questionId: "q2",
          questionIndex: 7,
          dimension: "商业",
          responseQuality: "partial",
        },
        {
          questionId: "q3",
          dimension: "unknown",
          responseQuality: "excellent",
        },
      ],
    }),
  );

  assert.deepEqual(
    result.qaReviews.map((review) => ({
      questionId: review.questionId,
      questionIndex: review.questionIndex,
      dimension: review.dimension,
      quality: review.responseQuality,
      label: review.responseQualityLabel,
    })),
    [
      {
        questionId: "auto-q1",
        questionIndex: 0,
        dimension: "TECHNICAL",
        quality: "GOOD",
        label: "回答良好",
      },
      {
        questionId: "q2",
        questionIndex: 7,
        dimension: "MARKET",
        quality: "PARTIAL",
        label: "部分回答",
      },
      {
        questionId: "q3",
        questionIndex: 2,
        dimension: "OTHER",
        quality: "WEAK",
        label: "回答偏弱",
      },
    ],
  );
  assert.deepEqual(result.qaReviews[0].missingPoints, [" keep spaces "]);
  assert.deepEqual(result.qaReviews[0].betterAnswerOutline, [" outline "]);
  assert.equal(result.qaReviews[0].question, "问题 1");
  assert.equal(result.qaReviews[0].evidenceUse, "未能提供有效证据。");
});

test("dynamic follow-up is null for invalid input and safely fills partial objects", () => {
  assert.equal(
    validateTrainingAnalysisResult(
      validAnalysis({ dynamicFollowupReview: [] }),
    ).dynamicFollowupReview,
    null,
  );

  assert.deepEqual(
    validateTrainingAnalysisResult(
      validAnalysis({
        dynamicFollowupReview: {
          questionId: " q1 ",
          question: null,
          targetWeakness: " weak ",
        },
      }),
    ).dynamicFollowupReview,
    {
      questionId: "q1",
      question: "",
      answerSummary: "",
      targetWeakness: "weak",
      evidenceSupplement: "",
      improvementAdvice: "",
    },
  );
});

test("next training tasks fall back only for nullish input", () => {
  assert.deepEqual(
    validateTrainingAnalysisResult(
      validAnalysis({ suggestions: [" 建议一 "], nextTrainingTasks: null }),
    ).nextTrainingTasks,
    ["建议一"],
  );
  assert.deepEqual(
    validateTrainingAnalysisResult(
      validAnalysis({ suggestions: ["建议一"], nextTrainingTasks: [] }),
    ).nextTrainingTasks,
    [],
  );
});
