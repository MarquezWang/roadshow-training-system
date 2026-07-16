import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";

const source = await readFile(
  new URL("../../lib/training-analysis-fallback.ts", import.meta.url),
  "utf8",
);
const transpiled = ts.transpileModule(source, {
  compilerOptions: {
    module: ts.ModuleKind.ESNext,
    target: ts.ScriptTarget.ES2022,
  },
}).outputText;
const moduleUrl = `data:text/javascript;base64,${Buffer.from(transpiled).toString("base64")}`;
const { isFallbackTrainingAnalysis } = await import(moduleUrl);

const normalAnalysis = {
  summary: "项目介绍了数据库服务降级方案和恢复策略。",
  errorMessage: null,
  rawResultJson: JSON.stringify({
    summary: "项目介绍了数据库服务降级方案和恢复策略。",
  }),
};

test("explicit non-fallback metadata is authoritative over report wording", () => {
  assert.equal(
    isFallbackTrainingAnalysis({
      ...normalAnalysis,
      isFallback: false,
      fallbackReason: null,
    }),
    false,
  );
});

test("explicit fallback metadata does not depend on localized wording", () => {
  assert.equal(
    isFallbackTrainingAnalysis({
      ...normalAnalysis,
      summary: "A limited report was generated.",
      rawResultJson: "{}",
      isFallback: true,
      fallbackReason: "AI_EMPTY_CONTENT",
    }),
    true,
  );
});

test("fallback reason marks inconsistent legacy metadata as fallback", () => {
  assert.equal(
    isFallbackTrainingAnalysis({
      ...normalAnalysis,
      isFallback: false,
      fallbackReason: "LEGACY_INFERRED_FALLBACK",
    }),
    true,
  );
});

test("records without explicit metadata retain transitional legacy detection", () => {
  assert.equal(
    isFallbackTrainingAnalysis({
      summary: "系统已生成基础报告。",
      errorMessage: null,
      rawResultJson: "{}",
    }),
    true,
  );
});
