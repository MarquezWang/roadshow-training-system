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
const constantsUrl = transpileToDataUrl(
  await readSource("../../lib/material-diagnosis/constants.ts"),
);
const primitivesUrl = transpileToDataUrl(
  (await readSource("../../lib/material-diagnosis/primitives.ts")).replace(
    'from "./constants"',
    `from "${constantsUrl}"`,
  ),
);
const priorityTasksUrl = transpileToDataUrl(
  (await readSource("../../lib/material-diagnosis/priority-tasks.ts"))
    .replace(
      'from "@/lib/type-guards"',
      `from "${typeGuardsUrl}"`,
    )
    .replace('from "./primitives"', `from "${primitivesUrl}"`),
);
const criteriaUrl = transpileToDataUrl(
  (await readSource("../../lib/material-diagnosis/criteria.ts"))
    .replace(
      'from "@/lib/type-guards"',
      `from "${typeGuardsUrl}"`,
    )
    .replace('from "./constants"', `from "${constantsUrl}"`)
    .replace('from "./primitives"', `from "${primitivesUrl}"`),
);
const normalizeUrl = transpileToDataUrl(
  (await readSource("../../lib/material-diagnosis/normalize.ts"))
    .replace(
      'from "@/lib/type-guards"',
      `from "${typeGuardsUrl}"`,
    )
    .replace('from "./criteria"', `from "${criteriaUrl}"`)
    .replace('from "./primitives"', `from "${primitivesUrl}"`)
    .replace(
      'from "./priority-tasks"',
      `from "${priorityTasksUrl}"`,
    ),
);
const storageUrl = transpileToDataUrl(
  (await readSource("../../lib/material-diagnosis/storage.ts")).replace(
    'from "./constants"',
    `from "${constantsUrl}"`,
  ),
);

const constants = await import(constantsUrl);
const criteriaPolicy = await import(criteriaUrl);
const priorityTaskPolicy = await import(priorityTasksUrl);
const { normalizeMaterialDiagnosisResult } = await import(normalizeUrl);
const { parseStoredMaterialDiagnosis } = await import(storageUrl);

const criteria = [
  { category: "团队", name: "团队经验", weight: 4 },
  { category: "技术", name: "技术优势", weight: 10 },
  { category: null, name: "市场价值", weight: 5 },
];

test("public status lists and labels retain their full mappings", () => {
  assert.deepEqual(constants.evidenceStatuses, [
    "SUFFICIENT",
    "PARTIAL",
    "MISSING",
    "UNKNOWN",
  ]);
  assert.deepEqual(constants.readinessLevels, [
    "HIGH",
    "MEDIUM",
    "LOW",
    "INSUFFICIENT",
  ]);
  assert.deepEqual(constants.evidenceStatusLabel, {
    SUFFICIENT: "证据充分",
    PARTIAL: "部分充分",
    MISSING: "证据不足",
    UNKNOWN: "无法判断",
  });
  assert.deepEqual(constants.readinessLevelLabel, {
    HIGH: "材料准备度高",
    MEDIUM: "材料准备度中等",
    LOW: "材料准备度偏低",
    INSUFFICIENT: "材料证据不足",
  });
});

test("readiness score keeps weighted evidence ratios and rounding", () => {
  assert.equal(
    criteriaPolicy.calculateReadinessScore([
      { weight: 10, evidenceStatus: "SUFFICIENT" },
      { weight: 10, evidenceStatus: "PARTIAL" },
      { weight: 10, evidenceStatus: "MISSING" },
      { weight: 10, evidenceStatus: "UNKNOWN" },
    ]),
    46,
  );
  assert.equal(criteriaPolicy.calculateReadinessScore([]), 0);
  assert.equal(
    criteriaPolicy.calculateReadinessScore([
      { weight: 0, evidenceStatus: "SUFFICIENT" },
      { weight: -1, evidenceStatus: "SUFFICIENT" },
    ]),
    0,
  );
});

test("readiness level thresholds retain exact boundaries", () => {
  for (const [score, level] of [
    [100, "HIGH"],
    [80, "HIGH"],
    [79, "MEDIUM"],
    [60, "MEDIUM"],
    [59, "LOW"],
    [40, "LOW"],
    [39, "INSUFFICIENT"],
    [Number.NaN, "INSUFFICIENT"],
  ]) {
    assert.equal(criteriaPolicy.deriveReadinessLevel(score), level);
  }
});

test("normalization rejects invalid roots and an empty evaluation rule", () => {
  for (const value of [null, [], "invalid"]) {
    assert.throws(
      () => normalizeMaterialDiagnosisResult(value, criteria),
      /材料诊断 AI JSON 顶层结构必须是对象。/,
    );
  }
  assert.throws(
    () => normalizeMaterialDiagnosisResult({}, []),
    /当前评审规则没有诊断指标。/,
  );
});

test("same-name criteria match their exact categories before name fallback", () => {
  const sameNameCriteria = [
    { category: "团队", name: "共同指标", weight: 4 },
    { category: "技术", name: "共同指标", weight: 6 },
    { category: null, name: "其他指标", weight: 5 },
  ];
  const result = normalizeMaterialDiagnosisResult(
    {
      criteriaResults: [
        {
          category: "团队",
          criterionName: "共同指标",
          weight: 99,
          evidenceStatus: "SUFFICIENT",
        },
        {
          category: "技术",
          criterionName: "共同指标",
          weight: 99,
          evidenceStatus: "PARTIAL",
        },
        {
          criterion: "其他指标",
          evidenceStatus: "MISSING",
        },
      ],
    },
    sameNameCriteria,
  );

  assert.deepEqual(
    result.criteriaResults.map(
      ({ category, criterionName, weight, evidenceStatus }) => ({
        category,
        criterionName,
        weight,
        evidenceStatus,
      }),
    ),
    [
      {
        category: "团队",
        criterionName: "共同指标",
        weight: 4,
        evidenceStatus: "SUFFICIENT",
      },
      {
        category: "技术",
        criterionName: "共同指标",
        weight: 6,
        evidenceStatus: "PARTIAL",
      },
      {
        category: "",
        criterionName: "其他指标",
        weight: 5,
        evidenceStatus: "MISSING",
      },
    ],
  );
});

test("criterion defaults depend on normalized evidence status", () => {
  const result = normalizeMaterialDiagnosisResult(
    {
      criteriaResults: [
        {
          criterionName: "团队经验",
          evidenceStatus: "SUFFICIENT",
          likelyJudgeQuestions: [" Q1 ", "Q2", "Q3", "Q4", null],
        },
        {
          criterionName: "技术优势",
          evidenceStatus: "MISSING",
        },
        {
          criterionName: "市场价值",
          evidenceStatus: "invalid",
          improvementAdvice: " custom advice ",
        },
      ],
    },
    criteria,
  );
  const [sufficient, missing, unknown] = result.criteriaResults;

  assert.equal(sufficient.evidenceSummary, "材料证据需要进一步核验。");
  assert.equal(sufficient.issueSummary, "暂无明显材料缺口。");
  assert.deepEqual(sufficient.likelyJudgeQuestions, ["Q1", "Q2", "Q3"]);
  assert.equal(missing.evidenceSummary, "材料未提供足够证据。");
  assert.equal(missing.issueSummary, "该项材料证据不足或表达不够清晰。");
  assert.equal(unknown.evidenceStatus, "UNKNOWN");
  assert.equal(unknown.improvementAdvice, "custom advice");
});

test("top-level lists are trimmed, capped, merged, and deduplicated", () => {
  const result = normalizeMaterialDiagnosisResult(
    {
      summary: " ",
      strengths: [" a ", null, "b", "c", "d", "e", "f"],
      weaknesses: [" w1 ", "w2", "w3", "w4", "w5", "w6"],
      judgeQuestions: [" Q1 ", "Q2", "Q1"],
      criteriaResults: [
        {
          criterionName: "团队经验",
          evidenceStatus: "SUFFICIENT",
          likelyJudgeQuestions: ["Q2", "Q3"],
        },
        {
          criterionName: "技术优势",
          evidenceStatus: "PARTIAL",
          likelyJudgeQuestions: ["Q4", "Q5", "Q6"],
        },
        {
          criterionName: "市场价值",
          evidenceStatus: "MISSING",
          likelyJudgeQuestions: ["Q7", "Q8", "Q9"],
        },
      ],
    },
    criteria,
  );

  assert.equal(
    result.summary,
    "系统已根据当前项目档案和材料文本生成赛前材料诊断。",
  );
  assert.deepEqual(result.strengths, ["a", "b", "c", "d", "e"]);
  assert.deepEqual(result.weaknesses, ["w1", "w2", "w3", "w4", "w5"]);
  assert.deepEqual(result.judgeQuestions, [
    "Q1",
    "Q2",
    "Q3",
    "Q4",
    "Q5",
    "Q6",
    "Q7",
    "Q8",
  ]);
  assert.equal(result.readinessScore, 59);
  assert.equal(result.readinessLevel, "LOW");
});

test("priority tasks require a title or action and retain default wording", () => {
  const tasks = priorityTaskPolicy.normalizePriorityTasks([
    null,
    {},
    { action: " action ", relatedCriteria: [" A ", "", 1] },
    { title: " title ", reason: " ", action: "" },
    { title: "t3" },
    { title: "t4" },
    { title: "t5" },
    { title: "t6" },
  ]);

  assert.equal(tasks.length, 5);
  assert.deepEqual(tasks[0], {
    title: "补充材料证据",
    reason: "当前材料证据不足。",
    action: "action",
    relatedCriteria: ["A"],
  });
  assert.deepEqual(tasks[1], {
    title: "title",
    reason: "",
    action: "补充可核验的事实、数据、案例或证明材料。",
    relatedCriteria: [],
  });
});

function storedDiagnosis(overrides = {}) {
  return {
    summary: "stored summary",
    readinessLevel: "HIGH",
    readinessScore: 80,
    strengths: '["strength"]',
    weaknesses: '["weakness"]',
    priorityTasks: '[]',
    judgeQuestions: '["question"]',
    criteriaResults: '[]',
    ...overrides,
  };
}

test("stored parsing preserves valid values and falls back invalid readiness", () => {
  assert.deepEqual(parseStoredMaterialDiagnosis(storedDiagnosis()), {
    summary: "stored summary",
    readinessLevel: "HIGH",
    readinessScore: 80,
    strengths: ["strength"],
    weaknesses: ["weakness"],
    priorityTasks: [],
    judgeQuestions: ["question"],
    criteriaResults: [],
  });

  const fallback = parseStoredMaterialDiagnosis(
    storedDiagnosis({ readinessLevel: "INVALID", readinessScore: null }),
  );
  assert.equal(fallback.readinessLevel, "INSUFFICIENT");
  assert.equal(fallback.readinessScore, undefined);
  assert.equal(Object.hasOwn(fallback, "readinessScore"), true);
});

test("stored parsing keeps zero scores and propagates malformed JSON", () => {
  assert.equal(
    parseStoredMaterialDiagnosis(storedDiagnosis({ readinessScore: 0 }))
      .readinessScore,
    0,
  );
  assert.throws(
    () =>
      parseStoredMaterialDiagnosis(
        storedDiagnosis({ strengths: "not-json" }),
      ),
    SyntaxError,
  );
});
