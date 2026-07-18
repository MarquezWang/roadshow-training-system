import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";

async function tsModuleUrl(relativePath, transform = (source) => source) {
  const source = await readFile(new URL(relativePath, import.meta.url), "utf8");
  const output = ts.transpileModule(transform(source), {
    compilerOptions: {
      module: ts.ModuleKind.ESNext,
      target: ts.ScriptTarget.ES2022,
    },
  }).outputText;
  return `data:text/javascript;base64,${Buffer.from(output).toString("base64")}`;
}

const scoringV2Url = await tsModuleUrl("../../lib/scoring-v2.ts");
const typeGuardsUrl = await tsModuleUrl("../../lib/type-guards.ts");
const primitivesUrl = await tsModuleUrl(
  "../../lib/scoring-validator/primitives.ts",
);
const categoriesUrl = await tsModuleUrl(
  "../../lib/scoring-validator/categories.ts",
);
const evidenceUrl = await tsModuleUrl(
  "../../lib/scoring-validator/evidence.ts",
  (source) =>
    source
      .replace(
        'from "@/lib/type-guards"',
        `from "${typeGuardsUrl}"`,
      )
      .replace('from "./primitives"', `from "${primitivesUrl}"`),
);
const itemUrl = await tsModuleUrl(
  "../../lib/scoring-validator/item.ts",
  (source) =>
    source
      .replace('from "@/lib/scoring-v2"', `from "${scoringV2Url}"`)
      .replace('from "./evidence"', `from "${evidenceUrl}"`)
      .replace('from "./primitives"', `from "${primitivesUrl}"`)
      .replace('from "./categories"', `from "${categoriesUrl}"`),
);
const validateUrl = await tsModuleUrl(
  "../../lib/scoring-validator/validate.ts",
  (source) =>
    source
      .replace(
        'from "@/lib/type-guards"',
        `from "${typeGuardsUrl}"`,
      )
      .replace('from "./categories"', `from "${categoriesUrl}"`)
      .replace('from "./item"', `from "${itemUrl}"`)
      .replace('from "./primitives"', `from "${primitivesUrl}"`),
);
const { validateScoreResult } = await import(validateUrl);

const criteria = [
  { category: "团队", name: "团队经验", weight: 4 },
  { category: null, name: "进入壁垒", weight: 10 },
  { category: "市场", name: "市场价值", weight: 5 },
];

function scoreItem(criterion, overrides = {}) {
  const result = {
    category: criterion.category || "未分类",
    criterion: criterion.name,
    maxScore: criterion.weight,
    aiSuggestedScore: criterion.weight,
    reason: "材料有相关描述。",
    deductionReason: "证据仍需补充。",
    suggestion: "补充关键证据。",
    evidenceStrength: "PARTIAL",
    riskLevel: "MEDIUM",
    evidence: {
      evidenceText: "材料提供了相关描述。",
      evidenceLocation: "材料正文",
    },
    ...overrides,
  };
  if (overrides.evidence) {
    result.evidence = {
      evidenceText: "材料提供了相关描述。",
      evidenceLocation: "材料正文",
      ...overrides.evidence,
    };
  }
  return result;
}

function scoreJson(itemOverrides = {}, topLevelOverrides = {}) {
  return {
    scoreItems: criteria.map((criterion) =>
      scoreItem(criterion, itemOverrides[criterion.name]),
    ),
    overallComment: "总体评价",
    scoreWarnings: [],
    ...topLevelOverrides,
  };
}

function replaceItem(source, index, overrides) {
  const copy = structuredClone(source);
  copy.scoreItems[index] = {
    ...copy.scoreItems[index],
    ...overrides,
  };
  return copy;
}

test("top-level and score item shapes retain exact failures", () => {
  assert.throws(
    () => validateScoreResult(null, criteria),
    /评分 JSON 顶层结构必须是对象。/,
  );
  assert.throws(
    () => validateScoreResult({}, criteria),
    /评分 JSON 字段 scoreItems 必须是数组。/,
  );
  assert.throws(
    () =>
      validateScoreResult(
        { ...scoreJson(), scoreItems: scoreJson().scoreItems.slice(0, 2) },
        criteria,
      ),
    /scoreItems 数量应为 3，当前为 2。/,
  );
  const invalidItem = scoreJson();
  invalidItem.scoreItems[0] = null;
  assert.throws(
    () => validateScoreResult(invalidItem, criteria),
    /scoreItems\[0\] 必须是对象。/,
  );
});

test("criterion matching rejects wrong types, unknown names, and duplicates", () => {
  assert.throws(
    () =>
      validateScoreResult(
        replaceItem(scoreJson(), 0, { criterion: 1 }),
        criteria,
      ),
    /scoreItems\[0\]\.criterion 必须是字符串。/,
  );
  assert.throws(
    () =>
      validateScoreResult(
        replaceItem(scoreJson(), 0, { criterion: "未知指标" }),
        criteria,
      ),
    /无法匹配评分指标：未知指标/,
  );
  assert.throws(
    () =>
      validateScoreResult(
        replaceItem(scoreJson(), 1, { criterion: "团队经验" }),
        criteria,
      ),
    /scoreItems 中存在重复评分指标：团队经验/,
  );
});

test("category, max score, and AI suggestion boundaries remain strict", () => {
  assert.equal(
    validateScoreResult(scoreJson(), criteria).scoreItems[1].category,
    "未分类",
  );
  assert.throws(
    () =>
      validateScoreResult(
        replaceItem(scoreJson(), 0, { category: "错误分类" }),
        criteria,
      ),
    /category 应为 团队，当前为 错误分类。/,
  );
  assert.throws(
    () =>
      validateScoreResult(
        replaceItem(scoreJson(), 0, { maxScore: 4.5 }),
        criteria,
      ),
    /maxScore 必须是整数。/,
  );
  assert.throws(
    () =>
      validateScoreResult(
        replaceItem(scoreJson(), 0, { maxScore: 5 }),
        criteria,
      ),
    /maxScore 应为 4，当前为 5。/,
  );
  assert.throws(
    () =>
      validateScoreResult(
        replaceItem(scoreJson(), 0, { aiSuggestedScore: 5 }),
        criteria,
      ),
    /aiSuggestedScore 必须在 0 到 4 之间，当前为 5。/,
  );

  const fallbackScore = scoreJson();
  fallbackScore.scoreItems[0].aiSuggestedScore = null;
  fallbackScore.scoreItems[0].score = 2;
  assert.equal(
    validateScoreResult(fallbackScore, criteria).scoreItems[0].aiSuggestedScore,
    2,
  );
});

test("required text and evidence fields preserve trimming rules", () => {
  for (const [overrides, message] of [
    [{ reason: null }, "评分 JSON 字段 scoreItems[0].reason 必须是字符串。"],
    [
      { deductionReason: null },
      "评分 JSON 字段 scoreItems[0].deductionReason 必须是字符串。",
    ],
    [
      { suggestion: null },
      "评分 JSON 字段 scoreItems[0].suggestion 必须是字符串。",
    ],
    [{ evidence: null }, "评分 JSON 字段 scoreItems[0].evidence 必须是对象。"],
    [
      { evidence: { evidenceText: " ", evidenceLocation: "x" } },
      "评分 JSON 字段 scoreItems[0].evidence.evidenceText 不能为空。",
    ],
  ]) {
    assert.throws(
      () => validateScoreResult(replaceItem(scoreJson(), 0, overrides), criteria),
      (error) => error instanceof Error && error.message === message,
    );
  }

  const result = validateScoreResult(
    replaceItem(scoreJson(), 0, {
      reason: " reason with spaces ",
      evidence: {
        evidenceText: " evidence text ",
        evidenceLocation: " page 1 ",
      },
    }),
    criteria,
  );
  assert.equal(result.scoreItems[0].reason, " reason with spaces ");
  assert.deepEqual(result.scoreItems[0].evidence, {
    evidenceText: "evidence text",
    evidenceLocation: "page 1",
  });
});

test("evidence strength and risk level reject missing and unknown values", () => {
  for (const [field, value, message] of [
    ["evidenceStrength", null, "不能为空。"],
    ["evidenceStrength", "SUPPORTED", "必须是 STRONG、PARTIAL 或 MISSING。"],
    ["riskLevel", null, "不能为空。"],
    ["riskLevel", "CRITICAL", "必须是 LOW、MEDIUM、HIGH 或 UNKNOWN。"],
  ]) {
    assert.throws(
      () =>
        validateScoreResult(
          replaceItem(scoreJson(), 0, { [field]: value }),
          criteria,
        ),
      (error) =>
        error instanceof Error &&
        error.message === `评分 JSON 字段 scoreItems[0].${field} ${message}`,
    );
  }
});

test("missing evidence and unsupported numbers normalize in warning order", () => {
  const source = scoreJson(
    {
      团队经验: {
        evidenceStrength: "MISSING",
        riskLevel: "UNKNOWN",
        reason: "团队拥有10年经验。",
        deductionReason: "尚缺3项证明。",
        suggestion: "补充2个案例。",
        evidence: {
          evidenceText: "没有看到团队履历",
          evidenceLocation: "",
        },
      },
    },
    { scoreWarnings: ["existing-warning"] },
  );
  const result = validateScoreResult(source, criteria);
  const normalized = result.scoreItems[0];

  assert.equal(normalized.evidence.evidenceText, "材料未提供相关证据。");
  assert.equal(
    normalized.reason,
    "材料证据不足，未采纳无依据的具体数字表述。",
  );
  assert.equal(
    normalized.deductionReason,
    "材料未提供可核验的具体数量依据。",
  );
  assert.equal(
    normalized.suggestion,
    "补充可核验的数量、指标、客户、案例或测试结果依据。",
  );
  assert.deepEqual(result.normalizedEvidenceItems, ["团队经验"]);
  assert.deepEqual(result.scoreWarnings, [
    "existing-warning",
    'normalizedMissingEvidenceText: ["团队经验"]',
    {
      type: "normalizedUnsupportedNumericClaim",
      criterion: "团队经验",
      fields: ["reason", "deductionReason", "suggestion"],
    },
  ]);
});

test("numeric claims remain when the evidence contains matching facts", () => {
  const result = validateScoreResult(
    scoreJson({
      市场价值: {
        evidenceStrength: "STRONG",
        riskLevel: "LOW",
        reason: "已签约3家客户。",
        deductionReason: "仍需扩大到十家客户。",
        suggestion: "下一轮覆盖5个省。",
        evidence: {
          evidenceText: "材料列出已签约3家客户并计划覆盖5个省。",
          evidenceLocation: "客户清单",
        },
      },
    }),
    criteria,
  );
  const item = result.scoreItems[2];
  assert.equal(item.reason, "已签约3家客户。");
  assert.equal(item.suggestion, "下一轮覆盖5个省。");
  assert.equal(
    result.scoreWarnings.some(
      (warning) =>
        typeof warning === "object" &&
        warning.type === "normalizedUnsupportedNumericClaim",
    ),
    false,
  );
});

test("category aggregation is deterministic and preserves criterion order", () => {
  const groupedCriteria = [
    { category: "团队", name: "团队经验", weight: 4 },
    { category: null, name: "进入壁垒", weight: 10 },
    { category: "团队", name: "市场价值", weight: 5 },
  ];
  const source = {
    scoreItems: groupedCriteria.map((criterion) => scoreItem(criterion)),
    overallComment: 123,
  };
  const result = validateScoreResult(source, groupedCriteria);

  assert.deepEqual(
    result.categoryScores.map(({ category, maxScore }) => ({
      category,
      maxScore,
    })),
    [
      { category: "团队", maxScore: 9 },
      { category: "未分类", maxScore: 10 },
    ],
  );
  assert.equal(
    result.totalScore,
    result.categoryScores.reduce((sum, category) => sum + category.score, 0),
  );
  assert.equal(
    result.overallComment,
    "材料评分由证据强度和风险等级确定性映射生成。",
  );
  assert.ok(
    result.categoryScores.every(
      ({ reason }) =>
        reason ===
        "由后端根据 scoreItems 的 evidenceStrength 和 riskLevel 确定性汇总。",
    ),
  );
});

test("scoreWarnings ignores non-arrays but rejects mixed arrays", () => {
  assert.deepEqual(
    validateScoreResult(
      scoreJson({}, { scoreWarnings: "warning" }),
      criteria,
    ).scoreWarnings,
    [],
  );
  assert.throws(
    () =>
      validateScoreResult(
        scoreJson({}, { scoreWarnings: ["valid", 1] }),
        criteria,
      ),
    /评分 JSON 字段 scoreWarnings 必须是字符串数组。/,
  );
});
