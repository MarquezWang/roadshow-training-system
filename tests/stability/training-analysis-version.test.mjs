import assert from "node:assert/strict";
import test from "node:test";

import {
  getTrainingAnalysisGenerationContract,
  hashTrainingAnalysisGenerationContract,
} from "../../lib/training-analysis-version.mjs";

test("报告生成契约覆盖 Prompt、Schema、模型与规则版本", () => {
  const contract = getTrainingAnalysisGenerationContract({
    AI_MODEL_STRONG: "model-a",
    PITCH_ANALYSIS_MAX_OUTPUT_TOKENS: "12000",
    PITCH_ANALYSIS_REPAIR_MAX_OUTPUT_TOKENS: "16000",
  });

  assert.match(contract.promptVersion, /^pitch-performance-analysis:/);
  assert.match(contract.schemaVersion, /^training-analysis-result:/);
  assert.match(contract.ruleVersion, /^pitch-analysis-policy:/);
  assert.equal(contract.modelVersion, "model-a");
  assert.equal(contract.maxOutputTokens, 12000);
  assert.equal(contract.repairMaxOutputTokens, 16000);
});

test("模型或生成参数变化会改变报告生成契约指纹", () => {
  const first = getTrainingAnalysisGenerationContract({
    AI_MODEL_STRONG: "model-a",
  });
  const second = getTrainingAnalysisGenerationContract({
    AI_MODEL_STRONG: "model-b",
  });
  const third = getTrainingAnalysisGenerationContract({
    AI_MODEL_STRONG: "model-a",
    PITCH_ANALYSIS_MAX_OUTPUT_TOKENS: "8000",
  });

  assert.notEqual(
    hashTrainingAnalysisGenerationContract(first),
    hashTrainingAnalysisGenerationContract(second),
  );
  assert.notEqual(
    hashTrainingAnalysisGenerationContract(first),
    hashTrainingAnalysisGenerationContract(third),
  );
});
