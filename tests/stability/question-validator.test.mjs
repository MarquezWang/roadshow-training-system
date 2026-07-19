import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";

function dataModule(source) {
  const output = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.ESNext,
      target: ts.ScriptTarget.ES2022,
    },
  }).outputText;
  return `data:text/javascript;base64,${Buffer.from(output).toString("base64")}`;
}

const typeGuardsSource = await readFile(
  new URL("../../lib/type-guards.ts", import.meta.url),
  "utf8",
);
const typeGuardsUrl = dataModule(typeGuardsSource);
const validatorSource = (
  await readFile(new URL("../../lib/question-validator.ts", import.meta.url), "utf8")
).replace('"@/lib/type-guards"', JSON.stringify(typeGuardsUrl));
const { validateGeneratedQuestions } = await import(dataModule(validatorSource));

const perspectives = [
  "技术专家",
  "技术专家",
  "产业方",
  "产业方",
  "投资机构",
  "投资机构",
  "知识产权专家",
  "成果转化专家",
  "成果转化专家",
  "合作对接方",
];

function fixture(evidenceText) {
  return {
    questions: perspectives.map((perspective, index) => ({
      type: "事实核验",
      perspective,
      content:
        index === 0 ? "材料提到已签约3家客户，合同依据是什么？" : `${perspective}常规问题`,
      focus: "证据",
      suggestedDirection: "说明材料依据",
      evidence: {
        evidenceText: index === 0 ? evidenceText : "材料说明了项目背景。",
        evidenceLocation: "第 1 页",
      },
      factCheckNote: index === 0 ? "需核对材料原文" : "",
    })),
  };
}

for (const missingText of [
  "材料未提供相关证据。",
  "材料未提及该项内容。",
  "材料未明确说明。",
]) {
  test(`numeric questions reject missing-evidence variant: ${missingText}`, () => {
    assert.throws(
      () => validateGeneratedQuestions(fixture(missingText)),
      /evidenceText 未提供材料依据/,
    );
  });
}

test("numeric question evidence must be an actual material excerpt", () => {
  assert.throws(
    () =>
      validateGeneratedQuestions(fixture("材料列出已签约3家客户。"), {
        sourceTexts: ["项目正处于客户接洽阶段，尚未形成正式合同。"],
      }),
    /不是材料原文片段/,
  );

  assert.doesNotThrow(() =>
    validateGeneratedQuestions(fixture("材料列出已签约3家客户。"), {
      sourceTexts: ["项目进展：材料列出已签约3家客户。下一步将扩大交付。"],
    }),
  );
});
