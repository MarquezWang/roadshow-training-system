import type { TrainingAnalysisResult } from "@/lib/training-analysis-validator";

import type { TrainingAnalysisParseFailureDebug } from "./types";

export function buildStoredTrainingAnalysisResult(
  analysis: TrainingAnalysisResult,
  debug: TrainingAnalysisParseFailureDebug | null,
) {
  if (!debug) {
    return JSON.stringify(analysis, null, 2);
  }

  return JSON.stringify({ ...analysis, _debug: debug }, null, 2);
}
