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

async function importTsModule(relativePath, transform = (source) => source) {
  return import(await tsModuleUrl(relativePath, transform));
}

const fileSelection = await importTsModule(
  "../../lib/project-context/files.ts",
);
const expertSelection = await importTsModule(
  "../../lib/project-context/expert-comments.ts",
);
const historicalSelection = await importTsModule(
  "../../lib/project-context/historical-questions.ts",
);
const persistedJsonVersionsUrl = await tsModuleUrl(
  "../../lib/persisted-json-versions.ts",
);
const snapshot = await importTsModule(
  "../../lib/project-context/snapshot.ts",
  (source) =>
    source.replace(
      'from "@/lib/persisted-json-versions"',
      `from "${persistedJsonVersionsUrl}"`,
    ),
);

function expertComment(
  id,
  {
    field = "人工智能",
    dimension = "技术",
    text = `第${id}条专家评语包含充分证据`,
    createdAt = "2026-01-01T00:00:00.000Z",
  } = {},
) {
  return {
    id,
    contestName: null,
    projectField: field,
    dimension,
    commentText: text,
    problemType: null,
    suggestionType: null,
    scoreRange: null,
    createdAt: new Date(createdAt),
    updatedAt: new Date(createdAt),
  };
}

function historicalQuestion(
  id,
  {
    field = "人工智能",
    perspective = "技术专家",
    text = `第${id}个历史问题？`,
    createdAt = "2026-01-01T00:00:00.000Z",
  } = {},
) {
  return {
    id,
    contestName: null,
    projectField: field,
    perspective,
    questionText: text,
    focus: null,
    createdAt: new Date(createdAt),
    updatedAt: new Date(createdAt),
  };
}

test("project context snapshot only accepts the required structural arrays", () => {
  const valid = {
    project: { id: "project-1" },
    files: [],
    criteria: [],
    expertComments: [],
    historicalQuestions: [],
  };

  assert.deepEqual(
    snapshot.parseProjectAIContextSnapshot(JSON.stringify(valid)),
    valid,
  );
  assert.deepEqual(
    snapshot.parseProjectAIContextSnapshot(
      JSON.stringify(valid),
      "project-ai-context:2026-07-19.1",
    ),
    valid,
  );
  assert.equal(
    snapshot.parseProjectAIContextSnapshot(
      JSON.stringify(valid),
      "project-ai-context:v999",
    ),
    null,
  );
  assert.equal(snapshot.parseProjectAIContextSnapshot(undefined), null);
  assert.equal(snapshot.parseProjectAIContextSnapshot("{"), null);
  assert.equal(
    snapshot.parseProjectAIContextSnapshot(
      JSON.stringify({ ...valid, historicalQuestions: null }),
    ),
    null,
  );
});

test("file selection preserves per-file and aggregate truncation limits", () => {
  const result = fileSelection.takeProjectContextFileTexts([
    {
      id: "file-1",
      originalName: "one.txt",
      fileType: "text/plain",
      includeInAIContext: true,
      extractedText: "一".repeat(25_000),
    },
    {
      id: "file-2",
      originalName: "two.txt",
      fileType: "text/plain",
      includeInAIContext: true,
      extractedText: "二".repeat(20_000),
    },
    {
      id: "file-3",
      originalName: "three.txt",
      fileType: "text/plain",
      includeInAIContext: true,
      extractedText: "三".repeat(30_000),
    },
    {
      id: "file-4",
      originalName: "four.txt",
      fileType: "text/plain",
      includeInAIContext: true,
      extractedText: "四".repeat(10),
    },
  ]);

  assert.deepEqual(
    result.files.map((file) => [file.id, file.extractedText.length, file.truncated]),
    [
      ["file-1", 20_000, true],
      ["file-2", 20_000, false],
      ["file-3", 20_000, true],
    ],
  );
  assert.equal(
    result.files.reduce((total, file) => total + file.extractedText.length, 0),
    60_000,
  );
  assert.equal(result.filesTruncated, true);
  assert.equal(result.allFilesTextTruncated, true);
});

test("file selection leaves truncation flags clear for short input", () => {
  const result = fileSelection.takeProjectContextFileTexts([
    {
      id: "file-1",
      originalName: "one.txt",
      fileType: "text/plain",
      includeInAIContext: true,
      extractedText: "完整文本",
    },
  ]);

  assert.equal(result.files[0].extractedText, "完整文本");
  assert.equal(result.files[0].truncated, false);
  assert.equal(result.filesTruncated, false);
  assert.equal(result.allFilesTextTruncated, false);
});

test("comment dimension normalization keeps the existing keyword precedence", () => {
  assert.equal(
    expertSelection.normalizeCommentDimension("市场与技术协同"),
    "科技含量",
  );
  assert.equal(expertSelection.normalizeCommentDimension("专利布局"), "市场机会");
  assert.equal(expertSelection.normalizeCommentDimension("核心团队"), "项目团队");
  assert.equal(expertSelection.normalizeCommentDimension("PPT逻辑"), "路演表达");
  assert.equal(expertSelection.normalizeCommentDimension("财务规范"), "其他");
});

test("expert selection prioritizes matching fields and removes meaningless text", () => {
  const result = expertSelection.selectExpertComments(
    [
      expertComment("other", {
        field: "生物医药",
        createdAt: "2026-03-01T00:00:00.000Z",
      }),
      expertComment("generic", {
        field: null,
        createdAt: "2026-02-01T00:00:00.000Z",
      }),
      expertComment("exact", {
        text: "  技术证据   描述充分  ",
        createdAt: "2026-01-01T00:00:00.000Z",
      }),
      expertComment("meaningless", { text: "无意见。" }),
      expertComment("empty", { text: "   " }),
    ],
    "人工智能",
  );

  assert.deepEqual(
    result.comments.map((comment) => comment.id),
    ["exact", "generic", "other"],
  );
  assert.equal(result.comments[0].commentText, "技术证据 描述充分");
  assert.deepEqual(
    result.comments.map((comment) => comment.relevanceReason),
    [
      "projectField 与项目 field 完全匹配",
      "通用专家评语",
      "其他领域补充",
    ],
  );
  assert.deepEqual(result.debug, {
    totalAvailable: 5,
    selected: 3,
    byNormalizedDimension: { 科技含量: 3 },
    truncated: true,
  });
});

test("expert selection enforces dimension quotas and the shared presentation quota", () => {
  const comments = [
    ...Array.from({ length: 5 }, (_, index) =>
      expertComment(`team-${index}`, { dimension: "团队" }),
    ),
    ...Array.from({ length: 7 }, (_, index) =>
      expertComment(`tech-${index}`, { dimension: "研发" }),
    ),
    ...Array.from({ length: 9 }, (_, index) =>
      expertComment(`market-${index}`, { dimension: "客户需求" }),
    ),
    ...Array.from({ length: 2 }, (_, index) =>
      expertComment(`pitch-${index}`, { dimension: "答辩表达" }),
    ),
    ...Array.from({ length: 2 }, (_, index) =>
      expertComment(`other-${index}`, {
        dimension: "财务规范",
        text: `第${index}条补充建议内容完整清晰`,
      }),
    ),
  ];
  const result = expertSelection.selectExpertComments(comments, "人工智能");

  assert.equal(result.comments.length, 20);
  assert.deepEqual(result.debug.byNormalizedDimension, {
    项目团队: 4,
    科技含量: 6,
    市场机会: 8,
    路演表达: 2,
  });
  assert.equal(result.comments.some((comment) => comment.id.startsWith("other-")), false);
  assert.equal(result.debug.truncated, true);
});

test("expert selection limits long comments and defers short fallback comments", () => {
  const result = expertSelection.selectExpertComments(
    [
      expertComment("long-1", {
        text: "长".repeat(601),
        createdAt: "2026-04-01T00:00:00.000Z",
      }),
      expertComment("long-2", {
        text: "长".repeat(601),
        createdAt: "2026-03-01T00:00:00.000Z",
      }),
      expertComment("long-3", {
        text: "长".repeat(601),
        createdAt: "2026-02-01T00:00:00.000Z",
      }),
      expertComment("normal", { text: "技术证据描述充分完整" }),
      expertComment("short-team", { dimension: "团队", text: "需补充" }),
    ],
    "人工智能",
  );

  assert.deepEqual(
    result.comments.map((comment) => comment.id),
    ["long-1", "long-2", "normal", "short-team"],
  );
});

test("historical question selection covers ordered perspectives before filling", () => {
  const result = historicalSelection.selectHistoricalQuestions(
    [
      historicalQuestion("technical-generic", {
        field: null,
        perspective: "技术专家",
        createdAt: "2026-01-01T00:00:00.000Z",
      }),
      historicalQuestion("technical-exact", {
        perspective: "技术专家",
        createdAt: "2026-03-01T00:00:00.000Z",
      }),
      historicalQuestion("industry", {
        field: null,
        perspective: "产业方",
        createdAt: "2026-02-01T00:00:00.000Z",
      }),
      historicalQuestion("investment", {
        perspective: "投资机构",
        createdAt: "2026-04-01T00:00:00.000Z",
      }),
      historicalQuestion("ip", {
        field: "生物医药",
        perspective: "知识产权专家",
      }),
      historicalQuestion("extra", {
        perspective: "其他视角",
        createdAt: "2025-01-01T00:00:00.000Z",
      }),
    ],
    "人工智能",
  );

  assert.deepEqual(
    result.questions.map((question) => question.id),
    [
      "technical-exact",
      "industry",
      "investment",
      "ip",
      "extra",
      "technical-generic",
    ],
  );
  assert.deepEqual(result.debug.byPerspective, {
    技术专家: 2,
    产业方: 1,
    投资机构: 1,
    知识产权专家: 1,
    其他视角: 1,
  });
});

test("historical question selection filters blanks and caps output at twenty", () => {
  const questions = Array.from({ length: 22 }, (_, index) =>
    historicalQuestion(`question-${index}`, {
      perspective: "其他视角",
      createdAt: new Date(Date.UTC(2026, 0, index + 1)).toISOString(),
    }),
  );
  questions.push(historicalQuestion("blank", { text: "   " }));

  const result = historicalSelection.selectHistoricalQuestions(
    questions,
    "人工智能",
  );

  assert.deepEqual(
    result.questions.map((question) => question.id),
    Array.from({ length: 20 }, (_, index) => `question-${index}`),
  );
  assert.deepEqual(result.debug, {
    totalAvailable: 23,
    selected: 20,
    byPerspective: { 其他视角: 20 },
    truncated: true,
  });
});
