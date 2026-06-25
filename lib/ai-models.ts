export type AiModelTask =
  | "projectProfileRecognition"
  | "trlAssessment"
  | "judgeQuestionGeneration"
  | "dynamicFollowup"
  | "pitchAnalysis"
  | "reportGeneration"
  | "materialDiagnosis"
  | "scoring"
  | "aiConnectivityTest"
  | "lightweightSummary";

export const AI_MODEL_FAST =
  process.env.AI_MODEL_FAST?.trim() ||
  process.env.AI_MODEL?.trim() ||
  "deepseek-v4-flash";

export const AI_MODEL_STRONG =
  process.env.AI_MODEL_STRONG?.trim() ||
  process.env.AI_MODEL?.trim() ||
  "deepseek-v4-pro";

export function getAiModel(task: AiModelTask) {
  switch (task) {
    case "aiConnectivityTest":
    case "lightweightSummary":
      return AI_MODEL_FAST;
    case "projectProfileRecognition":
    case "trlAssessment":
    case "judgeQuestionGeneration":
    case "dynamicFollowup":
    case "pitchAnalysis":
    case "reportGeneration":
    case "materialDiagnosis":
    case "scoring":
      return AI_MODEL_STRONG;
  }
}
