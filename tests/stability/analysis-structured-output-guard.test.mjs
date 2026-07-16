import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const routePath = new URL(
  "../../app/training/[sessionId]/analysis/route.ts",
  import.meta.url,
);
const generationPath = new URL(
  "../../lib/training-analysis-ai.ts",
  import.meta.url,
);
const hookPath = new URL(
  "../../app/training/[sessionId]/report/use-report-analysis-generation.ts",
  import.meta.url,
);
const overviewPath = new URL(
  "../../app/training/[sessionId]/report/report-overview.tsx",
  import.meta.url,
);
const reportPagePath = new URL(
  "../../app/training/[sessionId]/report/page.tsx",
  import.meta.url,
);
const reportDataPath = new URL(
  "../../app/training/[sessionId]/report/report-page-data.ts",
  import.meta.url,
);

test("报告 Schema 校验失败进入修复流程并保存可定位诊断", async () => {
  const source = await readFile(generationPath, "utf8");

  assert.doesNotMatch(
    source,
    /if\s*\(\s*!\(error instanceof AIJsonParseError\)\s*\)\s*\{\s*throw error;/,
  );
  assert.match(source, /AI_STRUCTURED_OUTPUT_INVALID/);
  assert.match(source, /initialError:\s*debug\.initialParseError\.message/);
  assert.match(source, /repairError:\s*debug\.repairError\.message/);
  assert.match(source, /sessionId:\s*debugContext\.sessionId/);
  assert.match(source, /rawAiOutput:\s*truncateDebugText\(input\.rawText\)/);
});

test("降级报告支持显式重新生成且保留旧版本", async () => {
  const [route, hook, overview] = await Promise.all([
    readFile(routePath, "utf8"),
    readFile(hookPath, "utf8"),
    readFile(overviewPath, "utf8"),
  ]);

  assert.match(route, /searchParams\.get\("force"\) === "true"/);
  assert.match(route, /!staleCheck\.stale && !forceRegeneration/);
  assert.match(route, /isFallbackReport:\s*isFallbackTrainingAnalysis\(analysis\)/);
  assert.match(route, /isFallback:\s*analysisFallbackReason !== null/);
  assert.match(route, /fallbackReason:\s*analysisFallbackReason/);
  assert.match(hook, /\?force=true/);
  assert.match(overview, /重新生成完整报告/);
});

test("重新生成期间继续展示 currentAnalysis，只有 COMPLETED 才替换前端报告", async () => {
  const [hook, page, reportData] = await Promise.all([
    readFile(hookPath, "utf8"),
    readFile(reportPagePath, "utf8"),
    readFile(reportDataPath, "utf8"),
  ]);

  assert.match(reportData, /currentAnalysis:\s*\{/);
  assert.match(page, /const initialAnalysis = analysis/);
  assert.match(
    hook,
    /if \(body\.analysis\.status === "COMPLETED"\) \{\s*setAnalysis\(body\.analysis\)/,
  );
  assert.doesNotMatch(hook, /setAnalysis\(body\.analysis\);\s*if/);
});
