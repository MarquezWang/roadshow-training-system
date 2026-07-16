import { createHash } from "node:crypto";

export const TRAINING_ANALYSIS_INPUT_HASH_VERSION = "v3";
export const TRAINING_ANALYSIS_PROMPT_VERSION =
  "pitch-performance-analysis:2026-07-13.1";
export const TRAINING_ANALYSIS_SCHEMA_VERSION =
  "training-analysis-result:2026-07-13.1";
export const TRAINING_ANALYSIS_RULE_VERSION =
  "pitch-analysis-policy:2026-07-13.1";
export const TRAINING_ANALYSIS_LEGACY_VERSION = "legacy-unknown";

function readPositiveInteger(env, name, fallback) {
  const value = Number(env[name]);
  return Number.isInteger(value) && value > 0 ? value : fallback;
}

export function getTrainingAnalysisGenerationContract(env = process.env) {
  return {
    promptVersion: TRAINING_ANALYSIS_PROMPT_VERSION,
    schemaVersion: TRAINING_ANALYSIS_SCHEMA_VERSION,
    modelVersion:
      env.AI_MODEL_STRONG?.trim() ||
      env.AI_MODEL?.trim() ||
      "deepseek-v4-pro",
    ruleVersion: TRAINING_ANALYSIS_RULE_VERSION,
    temperature: 0.2,
    maxOutputTokens: readPositiveInteger(
      env,
      "PITCH_ANALYSIS_MAX_OUTPUT_TOKENS",
      12_000,
    ),
    repairMaxOutputTokens: readPositiveInteger(
      env,
      "PITCH_ANALYSIS_REPAIR_MAX_OUTPUT_TOKENS",
      16_000,
    ),
    responseFormat: "json_object",
  };
}

export function hashTrainingAnalysisGenerationContract(contract) {
  return createHash("sha256")
    .update(JSON.stringify(contract))
    .digest("hex");
}
