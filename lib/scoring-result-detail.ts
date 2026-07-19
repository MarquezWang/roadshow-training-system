import type { ValidatedScoreResult } from "@/lib/scoring-validator";

export const MATERIAL_SCORING_METHOD = "evidence_mapper_v2";
export const MATERIAL_SCORE_SCHEMA_VERSION =
  "material-score-detail:2026-07-19.1";
export const MATERIAL_SCORE_LEGACY_SCHEMA_VERSION =
  "material-score-detail:legacy-v0";

export type MaterialScoreDetail = Readonly<{
  scoringMethod: string;
  categoryScores: ValidatedScoreResult["categoryScores"];
  scoreItems: ValidatedScoreResult["scoreItems"];
  scoreWarnings: ValidatedScoreResult["scoreWarnings"];
  warnings: ValidatedScoreResult["scoreWarnings"];
  normalizedEvidenceItems: string[];
}>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function readArray<T>(value: unknown): T[] {
  return Array.isArray(value) ? (value as T[]) : [];
}

export function parseStoredMaterialScoreDetail(
  value: string,
  schemaVersion?: string,
): MaterialScoreDetail {
  const normalizedVersion = schemaVersion?.trim() || "legacy-unknown";
  if (
    normalizedVersion !== "legacy-unknown" &&
    normalizedVersion !== MATERIAL_SCORE_LEGACY_SCHEMA_VERSION &&
    normalizedVersion !== MATERIAL_SCORE_SCHEMA_VERSION
  ) {
    throw new Error(`不支持的材料评分 schemaVersion：${normalizedVersion}`);
  }

  const parsed = JSON.parse(value) as unknown;
  if (!isRecord(parsed)) {
    throw new Error("材料评分 scoreDetail 必须是 JSON 对象。");
  }

  const scoreWarnings = readArray<
    ValidatedScoreResult["scoreWarnings"][number]
  >(parsed.scoreWarnings ?? parsed.warnings);

  return {
    scoringMethod:
      typeof parsed.scoringMethod === "string"
        ? parsed.scoringMethod
        : "legacy-unknown",
    categoryScores: readArray<
      ValidatedScoreResult["categoryScores"][number]
    >(parsed.categoryScores),
    scoreItems: readArray<ValidatedScoreResult["scoreItems"][number]>(
      parsed.scoreItems,
    ),
    scoreWarnings,
    warnings: readArray<ValidatedScoreResult["scoreWarnings"][number]>(
      parsed.warnings ?? scoreWarnings,
    ),
    normalizedEvidenceItems: readArray<unknown>(
      parsed.normalizedEvidenceItems,
    ).filter((item): item is string => typeof item === "string"),
  };
}

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
