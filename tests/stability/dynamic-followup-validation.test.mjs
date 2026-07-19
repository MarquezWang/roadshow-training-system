import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";

async function tsModuleUrl(relativePath) {
  const source = await readFile(new URL(relativePath, import.meta.url), "utf8");
  const transpiled = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.ESNext,
      target: ts.ScriptTarget.ES2022,
    },
  }).outputText;

  return `data:text/javascript;base64,${Buffer.from(transpiled).toString("base64")}`;
}

const validationUrl = await tsModuleUrl(
  "../../lib/dynamic-followup-validation.ts",
);
const {
  normalizeMainMultipleQuestionText,
  validateFallbackFollowupText,
  validateMainFollowupText,
} = await import(validationUrl);

const aiRoadshowTranscript =
  "AI路演训练系统，用证据链评分与真实评委场景，让每一次路演都经得起检验。路演大赛参赛团队普遍缺乏低成本、高频次、贴近真实评审逻辑的赛前陪练手段，人工教练资源稀缺，成本高。AI路演训练系统包含材料诊断、模拟评委提问、路演答辩、动态追问和训练报告生成。";

test("dynamic follow-up validator rejects unsupported attributed facts generically", () => {
  const leakedQuestion =
    "你刚才提到系统已在两个县区供电所做过小范围试用，但样本规模还不大。请说明目前试用覆盖了多少条线路、识别准确率达到什么水平，以及后续如何验证不同天气条件下的稳定性？";

  assert.equal(
    validateMainFollowupText({
      text: leakedQuestion,
      transcriptText: aiRoadshowTranscript,
      regularQuestions: [],
    }),
    "main_output_unsupported_transcript_attribution",
  );

  assert.equal(
    validateFallbackFollowupText({
      text: leakedQuestion,
      transcriptText: aiRoadshowTranscript,
      regularQuestions: [],
    }),
    "fallback_output_unsupported_transcript_attribution",
  );
});

test("dynamic follow-up validator does not blacklist a legitimate project domain", () => {
  const transcript =
    "我们的智能咖啡机已经完成样机开发，能够根据豆型调整研磨参数，目前正通过盲测收集用户对口感和稳定性的反馈。";
  const question =
    "你刚才提到智能咖啡机已完成样机开发。请说明盲测将用哪些指标评价口感和运行稳定性？";

  assert.equal(
    validateMainFollowupText({
      text: question,
      transcriptText: transcript,
      regularQuestions: [],
    }),
    null,
  );
});

test("dynamic follow-up validator accepts domain terms when transcript supports them", () => {
  const powerTranscript =
    "我们已经完成原型系统研发，并在两个县区的供电所做过小范围试用。试用覆盖的线路数量还在扩大，样本规模还不大，识别准确率和不同天气条件下的稳定性还需要继续验证。";
  const supportedQuestion =
    "你刚才提到系统已在两个县区供电所做过小范围试用。请说明目前试用覆盖了多少条线路，以及后续如何验证不同天气条件下的稳定性？";

  assert.equal(
    validateMainFollowupText({
      text: supportedQuestion,
      transcriptText: powerTranscript,
      regularQuestions: [],
    }),
    null,
  );
});

test("multiple questions keep only the first semantic question", () => {
  assert.equal(
    normalizeMainMultipleQuestionText(
      "你会如何验证当前方案的实际效果？下一阶段准备进入哪些市场？",
    ),
    "你会如何验证当前方案的实际效果？",
  );
});
