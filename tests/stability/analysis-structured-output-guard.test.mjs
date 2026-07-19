import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const routePath = new URL(
  "../../app/training/[sessionId]/analysis/route.ts",
  import.meta.url,
);
const generationPath = new URL(
  "../../lib/training-analysis-ai/generation.ts",
  import.meta.url,
);
const parserPath = new URL(
  "../../lib/training-analysis-ai/parser.ts",
  import.meta.url,
);
const debugPath = new URL(
  "../../lib/training-analysis-ai/debug.ts",
  import.meta.url,
);
const debugTypesPath = new URL(
  "../../lib/training-analysis-ai/types.ts",
  import.meta.url,
);
const recordsPath = new URL(
  "../../app/training/[sessionId]/analysis/training-analysis-records.ts",
  import.meta.url,
);
const executorPath = new URL(
  "../../app/training/[sessionId]/analysis/training-analysis-executor.ts",
  import.meta.url,
);
const persistencePath = new URL(
  "../../app/training/[sessionId]/analysis/training-analysis-persistence.ts",
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
  const [generation, parser, debug, debugTypes] = await Promise.all([
    readFile(generationPath, "utf8"),
    readFile(parserPath, "utf8"),
    readFile(debugPath, "utf8"),
    readFile(debugTypesPath, "utf8"),
  ]);
  const source = [generation, parser, debug, debugTypes].join("\n");

  assert.doesNotMatch(
    parser,
    /if\s*\(\s*!\(error instanceof AIJsonParseError\)\s*\)\s*\{\s*throw error;/,
  );
  assert.match(source, /AI_STRUCTURED_OUTPUT_INVALID/);
  assert.match(source, /initialError:\s*debug\.initialParseError\.message/);
  assert.match(source, /repairError:\s*debug\.repairError\.message/);
  assert.match(source, /sessionId:\s*debugContext\.sessionId/);
  assert.match(source, /rawAiOutput:\s*truncateDebugText\(input\.rawText\)/);
});

test("降级报告支持显式重新生成且保留旧版本", async () => {
  const [route, executor, records, persistence, hook, overview] = await Promise.all([
    readFile(routePath, "utf8"),
    readFile(executorPath, "utf8"),
    readFile(recordsPath, "utf8"),
    readFile(persistencePath, "utf8"),
    readFile(hookPath, "utf8"),
    readFile(overviewPath, "utf8"),
  ]);

  assert.match(route, /searchParams\.get\("force"\) === "true"/);
  assert.match(executor, /!staleCheck\.stale && !forceRegeneration/);
  assert.match(
    records,
    /isFallbackReport:\s*isFallbackTrainingAnalysis\(analysis\)/,
  );
  assert.match(persistence, /isFallback:\s*input\.fallbackReason !== null/);
  assert.match(persistence, /fallbackReason:\s*input\.fallbackReason/);
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
