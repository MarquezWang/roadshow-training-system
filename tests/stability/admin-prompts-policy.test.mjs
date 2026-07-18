import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";

async function loadTypeScriptModule(relativePath) {
  const source = await readFile(new URL(relativePath, import.meta.url), "utf8");
  const transpiled = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.ESNext,
      target: ts.ScriptTarget.ES2022,
    },
  }).outputText;
  const moduleUrl = `data:text/javascript;base64,${Buffer.from(transpiled).toString("base64")}`;
  return import(moduleUrl);
}

const {
  createFilterHref,
  filterPrompts,
  formatBytes,
  getChangelogItems,
  normalizePromptFilters,
  summarizePrompts,
} = await loadTypeScriptModule("../../app/admin/prompts/prompt-policy.ts");
const { getPromptAsset } = await loadTypeScriptModule(
  "../../app/admin/prompts/prompt-assets.ts",
);

function prompt(overrides = {}) {
  return {
    file: "example.md",
    task: "示例任务",
    route: "app/example/route.ts",
    model: "strong",
    risk: "高",
    output: "示例输出",
    status: "已接入",
    size: 1024,
    updatedAt: new Date("2026-01-01T00:00:00Z"),
    ...overrides,
  };
}

test("Prompt 筛选参数只接受白名单中的单值", () => {
  assert.deepEqual(normalizePromptFilters({}), {
    model: "全部",
    risk: "全部",
    status: "全部",
  });
  assert.deepEqual(
    normalizePromptFilters({
      model: "strong",
      risk: "中",
      status: "未接入",
    }),
    { model: "strong", risk: "中", status: "未接入" },
  );
  assert.deepEqual(
    normalizePromptFilters({
      model: ["strong", "fast"],
      risk: "未知",
      status: "",
    }),
    { model: "全部", risk: "全部", status: "全部" },
  );
});

test("Prompt 筛选链接省略全部项并保留固定参数顺序", () => {
  assert.equal(
    createFilterHref({ model: "全部", risk: "全部", status: "全部" }),
    "/admin/prompts",
  );
  assert.equal(
    createFilterHref({ model: "strong", risk: "高", status: "未接入" }),
    "/admin/prompts?model=strong&risk=%E9%AB%98&status=%E6%9C%AA%E6%8E%A5%E5%85%A5",
  );
});

test("Prompt 列表按模型、风险和接入状态取交集", () => {
  const prompts = [
    prompt({ file: "strong-high.md" }),
    prompt({ file: "strong-low.md", risk: "低" }),
    prompt({ file: "fast-high.md", model: "fast", status: "未接入" }),
  ];

  assert.deepEqual(
    filterPrompts(prompts, {
      model: "strong",
      risk: "高",
      status: "已接入",
    }).map((item) => item.file),
    ["strong-high.md"],
  );
  assert.equal(
    filterPrompts(prompts, {
      model: "全部",
      risk: "全部",
      status: "全部",
    }).length,
    3,
  );
});

test("Prompt 摘要统计使用完整资产列表", () => {
  const summary = summarizePrompts([
    prompt(),
    prompt({ model: "fast", risk: "低", status: "未接入" }),
    prompt({ risk: "中" }),
  ]);

  assert.deepEqual(summary, {
    totalCount: 3,
    integratedCount: 2,
    strongCount: 2,
    highRiskCount: 1,
  });
});

test("Prompt 文件大小保持原有 B 和 KB 展示边界", () => {
  assert.equal(formatBytes(0), "0 B");
  assert.equal(formatBytes(1023), "1023 B");
  assert.equal(formatBytes(1024), "1.0 KB");
  assert.equal(formatBytes(1536), "1.5 KB");
});

test("Prompt 变更预览排除模板标题并最多返回五项", () => {
  const changelog = [
    "## Prompt 变更记录",
    "## 记录模板",
    "## YYYY-MM-DD 示例",
    "## 2026-07-06 A",
    "## 2026-07-05 B",
    "## 2026-07-04 C",
    "## 2026-07-03 D",
    "## 2026-07-02 E",
    "## 2026-07-01 F",
  ].join("\n");

  assert.deepEqual(getChangelogItems(changelog), [
    "2026-07-06 A",
    "2026-07-05 B",
    "2026-07-04 C",
    "2026-07-03 D",
    "2026-07-02 E",
  ]);
});

test("Prompt 资产登记保留已知配置并安全标记未知文件", () => {
  assert.deepEqual(getPromptAsset("project-summary.md"), {
    file: "project-summary.md",
    task: "AI 连通性测试 / 轻量摘要",
    route: "app/api/ai/test/route.ts",
    model: "fast",
    risk: "低",
    output: "轻量摘要或测试返回",
    status: "已接入",
  });
  assert.deepEqual(getPromptAsset("new-prompt.md"), {
    file: "new-prompt.md",
    task: "未登记",
    route: "未登记",
    model: "待确认",
    risk: "待确认",
    output: "未登记",
    status: "未接入",
  });
});
