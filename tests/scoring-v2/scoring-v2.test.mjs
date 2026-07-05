import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";

async function tsModuleUrl(relativePath, transformSource = (source) => source) {
  const source = await readFile(new URL(relativePath, import.meta.url), "utf8");
  const transpiled = ts.transpileModule(transformSource(source), {
    compilerOptions: {
      module: ts.ModuleKind.ESNext,
      target: ts.ScriptTarget.ES2022,
    },
  }).outputText;

  return `data:text/javascript;base64,${Buffer.from(transpiled).toString("base64")}`;
}

const scoringV2Url = await tsModuleUrl("../../lib/scoring-v2.ts");
const { deriveDeterministicMaterialScore } = await import(scoringV2Url);
const validatorUrl = await tsModuleUrl(
  "../../lib/scoring-validator.ts",
  (source) =>
    source.replace(
      'import { deriveDeterministicMaterialScore } from "@/lib/scoring-v2";',
      `import { deriveDeterministicMaterialScore } from "${scoringV2Url}";`,
    ),
);
const { validateScoreResult } = await import(validatorUrl);
const scoreDetailUrl = await tsModuleUrl(
  "../../lib/scoring-result-detail.ts",
);
const { buildMaterialScoreDetail, MATERIAL_SCORING_METHOD } =
  await import(scoreDetailUrl);

const criteria = [
  { category: "项目团队", name: "知识水平及工作经验", weight: 4 },
  { category: "项目团队", name: "团队结构", weight: 3 },
  { category: "项目团队", name: "稳定程度", weight: 3 },
  { category: "科技含量", name: "主体技术水平", weight: 10 },
  { category: "科技含量", name: "技术优势", weight: 10 },
  { category: "科技含量", name: "进入壁垒", weight: 10 },
  { category: "市场机会", name: "市场需求", weight: 5 },
  { category: "市场机会", name: "市场价值", weight: 5 },
  { category: "市场机会", name: "知识产权保护", weight: 5 },
  { category: "市场机会", name: "核心技术成熟度", weight: 5 },
  { category: "市场机会", name: "成果转化可靠性", weight: 5 },
  { category: "市场机会", name: "实施计划", weight: 10 },
];

function createScoreItem(criterion, overrides = {}) {
  const item = {
    category: criterion.category,
    criterion: criterion.name,
    maxScore: criterion.weight,
    aiSuggestedScore: criterion.weight,
    evidenceStrength: "PARTIAL",
    riskLevel: "MEDIUM",
    reason: "材料有相关描述。",
    deductionReason: "证据仍需补充。",
    suggestion: "补充关键证据。",
    evidence: {
      evidenceText: "材料提供了相关描述。",
      evidenceLocation: "测试材料",
    },
    ...overrides,
  };

  if (overrides.evidence) {
    item.evidence = {
      evidenceText: "材料提供了相关描述。",
      evidenceLocation: "测试材料",
      ...overrides.evidence,
    };
  }

  return item;
}

function createScoreJson(overridesByCriterion = {}) {
  return {
    scoreItems: criteria.map((criterion) =>
      createScoreItem(criterion, overridesByCriterion[criterion.name]),
    ),
    overallComment: "材料评分由证据映射生成。",
    scoreWarnings: [],
  };
}

function sum(values) {
  return values.reduce((total, value) => total + value, 0);
}

test("deriveDeterministicMaterialScore maps evidence strength tiers", () => {
  assert.equal(
    deriveDeterministicMaterialScore({
      criterion: "市场价值",
      maxScore: 10,
      evidenceStrength: "MISSING",
      riskLevel: "UNKNOWN",
    }).mappedScore,
    1,
  );
  assert.equal(
    deriveDeterministicMaterialScore({
      criterion: "市场价值",
      maxScore: 10,
      evidenceStrength: "PARTIAL",
      riskLevel: "MEDIUM",
    }).mappedScore,
    4,
  );
  assert.equal(
    deriveDeterministicMaterialScore({
      criterion: "市场价值",
      maxScore: 10,
      evidenceStrength: "STRONG",
      riskLevel: "LOW",
    }).mappedScore,
    9,
  );
});

test("deriveDeterministicMaterialScore applies risk adjustments", () => {
  const lowRisk = deriveDeterministicMaterialScore({
    criterion: "技术优势",
    maxScore: 10,
    evidenceStrength: "PARTIAL",
    riskLevel: "LOW",
  }).mappedScore;
  const mediumRisk = deriveDeterministicMaterialScore({
    criterion: "技术优势",
    maxScore: 10,
    evidenceStrength: "PARTIAL",
    riskLevel: "MEDIUM",
  }).mappedScore;
  const highRisk = deriveDeterministicMaterialScore({
    criterion: "技术优势",
    maxScore: 10,
    evidenceStrength: "PARTIAL",
    riskLevel: "HIGH",
  }).mappedScore;

  assert.equal(lowRisk, 5);
  assert.equal(mediumRisk, 4);
  assert.equal(highRisk, 3);
});

test("deriveDeterministicMaterialScore caps barrier criterion scores", () => {
  assert.equal(
    deriveDeterministicMaterialScore({
      criterion: "进入壁垒",
      maxScore: 20,
      evidenceStrength: "MISSING",
      riskLevel: "LOW",
    }).mappedScore,
    2,
  );
  assert.equal(
    deriveDeterministicMaterialScore({
      criterion: "进入壁垒",
      maxScore: 20,
      evidenceStrength: "PARTIAL",
      riskLevel: "LOW",
    }).mappedScore,
    5,
  );
  assert.equal(
    deriveDeterministicMaterialScore({
      criterion: "进入壁垒",
      maxScore: 20,
      evidenceStrength: "STRONG",
      riskLevel: "LOW",
    }).mappedScore,
    17,
  );
});

test("deriveDeterministicMaterialScore clamps scores to maxScore bounds", () => {
  const evidenceStrengths = ["MISSING", "PARTIAL", "STRONG"];
  const riskLevels = ["LOW", "MEDIUM", "HIGH", "UNKNOWN"];

  for (const evidenceStrength of evidenceStrengths) {
    for (const riskLevel of riskLevels) {
      const result = deriveDeterministicMaterialScore({
        criterion: "市场价值",
        maxScore: 10,
        evidenceStrength,
        riskLevel,
      });
      assert.ok(result.mappedScore >= 0);
      assert.ok(result.mappedScore <= result.maxScore);
    }
  }

  assert.equal(
    deriveDeterministicMaterialScore({
      criterion: "市场价值",
      maxScore: 10,
      evidenceStrength: "MISSING",
      riskLevel: "HIGH",
    }).mappedScore,
    0,
  );
  assert.throws(
    () =>
      deriveDeterministicMaterialScore({
        criterion: "市场价值",
        maxScore: 0,
        evidenceStrength: "STRONG",
        riskLevel: "LOW",
      }),
    /maxScore must be a positive number/,
  );
});

test("validateScoreResult requires all 12 criteria", () => {
  const scoreJson = createScoreJson();
  const result = validateScoreResult(scoreJson, criteria);

  assert.equal(result.scoreItems.length, 12);
  assert.equal(result.totalScore, sum(result.scoreItems.map((item) => item.score)));
  assert.equal(
    result.totalScore,
    sum(result.categoryScores.map((item) => item.score)),
  );

  const incomplete = createScoreJson();
  incomplete.scoreItems.pop();
  assert.throws(
    () => validateScoreResult(incomplete, criteria),
    /scoreItems 数量应为 12/,
  );
});

test("validateScoreResult requires criterion names to match", () => {
  const scoreJson = createScoreJson();
  scoreJson.scoreItems[0].criterion = "不存在的评分项";

  assert.throws(
    () => validateScoreResult(scoreJson, criteria),
    /无法匹配评分指标/,
  );
});

test("validateScoreResult normalizes non-standard missing evidence text", () => {
  const criterionName = "知识水平及工作经验";
  const result = validateScoreResult(
    createScoreJson({
      [criterionName]: {
        evidenceStrength: "MISSING",
        riskLevel: "UNKNOWN",
        reason: "材料缺少团队背景。",
        deductionReason: "无法确认团队经验。",
        evidence: {
          evidenceText: "没有看到这方面内容",
        },
      },
    }),
    criteria,
  );
  const normalizedItem = result.scoreItems.find(
    (item) => item.criterion === criterionName,
  );

  assert.equal(normalizedItem.evidence.evidenceText, "材料未提供相关证据。");
  assert.deepEqual(result.normalizedEvidenceItems, [criterionName]);
  assert.ok(
    result.scoreWarnings.some((warning) =>
      warning.includes(`"${criterionName}"`),
    ),
  );
});

test("validateScoreResult rejects STRONG items with missing evidence text", () => {
  assert.throws(
    () =>
      validateScoreResult(
        createScoreJson({
          市场价值: {
            evidenceStrength: "STRONG",
            riskLevel: "LOW",
            evidence: {
              evidenceText: "材料未提供相关证据。",
            },
          },
        }),
        criteria,
      ),
    /evidenceStrength 为 STRONG/,
  );
});

test("validateScoreResult normalizes unsupported numeric claims instead of throwing", () => {
  const criterionName = "技术优势";
  const result = validateScoreResult(
    createScoreJson({
      [criterionName]: {
        evidenceStrength: "PARTIAL",
        riskLevel: "MEDIUM",
        reason: "技术指标达到95%，明显领先竞品。",
        deductionReason: "材料未提供可核验的对比数据。",
        suggestion: "补充3个客户案例和2组测试结果。",
        evidence: {
          evidenceText: "材料描述了项目具有技术优势。",
        },
      },
    }),
    criteria,
  );
  const normalizedItem = result.scoreItems.find(
    (item) => item.criterion === criterionName,
  );
  const warning = result.scoreWarnings.find(
    (item) =>
      typeof item === "object" &&
      item.type === "normalizedUnsupportedNumericClaim" &&
      item.criterion === criterionName,
  );

  assert.equal(
    normalizedItem.reason,
    "材料证据不足，未采纳无依据的具体数字表述。",
  );
  assert.equal(
    normalizedItem.suggestion,
    "补充可核验的数量、指标、客户、案例或测试结果依据。",
  );
  assert.equal(normalizedItem.evidenceStrength, "PARTIAL");
  assert.equal(normalizedItem.evidence.evidenceText, "材料描述了项目具有技术优势。");
  assert.deepEqual(warning.fields, ["reason", "suggestion"]);
  assert.equal(result.totalScore, sum(result.scoreItems.map((item) => item.score)));
});

test("validateScoreResult excludes aiSuggestedScore from formal totalScore", () => {
  const result = validateScoreResult(createScoreJson(), criteria);
  const aiSuggestedTotal = sum(
    result.scoreItems.map((item) => item.aiSuggestedScore ?? 0),
  );

  assert.notEqual(result.totalScore, aiSuggestedTotal);
  assert.equal(result.totalScore, sum(result.scoreItems.map((item) => item.score)));
});

test("buildMaterialScoreDetail keeps route score detail invariants", () => {
  const scoreResult = validateScoreResult(createScoreJson(), criteria);
  const scoreDetail = buildMaterialScoreDetail(scoreResult);
  const scoreItemsTotal = sum(scoreDetail.scoreItems.map((item) => item.score));
  const categoryScoresTotal = sum(
    scoreDetail.categoryScores.map((item) => item.score),
  );
  const aiSuggestedTotal = sum(
    scoreDetail.scoreItems.map((item) => item.aiSuggestedScore ?? 0),
  );

  assert.equal(scoreDetail.scoringMethod, MATERIAL_SCORING_METHOD);
  assert.equal(scoreDetail.scoringMethod, "evidence_mapper_v2");
  assert.equal(scoreResult.totalScore, scoreItemsTotal);
  assert.equal(scoreResult.totalScore, categoryScoresTotal);
  assert.notEqual(scoreResult.totalScore, aiSuggestedTotal);
  assert.equal(scoreDetail.scoreItems.length, 12);
});
