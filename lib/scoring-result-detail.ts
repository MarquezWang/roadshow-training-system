import type { ValidatedScoreResult } from "@/lib/scoring-validator";

export const MATERIAL_SCORING_METHOD = "evidence_mapper_v2";

export type MaterialScoreDetail = Readonly<{
  scoringMethod: typeof MATERIAL_SCORING_METHOD;
  categoryScores: ValidatedScoreResult["categoryScores"];
  scoreItems: ValidatedScoreResult["scoreItems"];
  scoreWarnings: ValidatedScoreResult["scoreWarnings"];
  warnings: ValidatedScoreResult["scoreWarnings"];
  normalizedEvidenceItems: string[];
}>;

export function buildMaterialScoreDetail(
  scoreResult: ValidatedScoreResult,
): MaterialScoreDetail {
  return {
    scoringMethod: MATERIAL_SCORING_METHOD,
    categoryScores: scoreResult.categoryScores,
    scoreItems: scoreResult.scoreItems,
    scoreWarnings: scoreResult.scoreWarnings,
    warnings: scoreResult.scoreWarnings,
    normalizedEvidenceItems: scoreResult.normalizedEvidenceItems,
  };
}
