export type ScoreWeights = Readonly<{
  material: number;
  performance: number;
}>;

export type CompositeScoreInput = Readonly<{
  materialScore: number | null | undefined;
  performanceScore: number | null | undefined;
  weights?: Partial<ScoreWeights>;
}>;

export type CompositeScoreResult = Readonly<{
  materialScore: number;
  performanceScore: number;
  compositeScore: number;
  weights: ScoreWeights;
}>;

export type EvidenceStrength = "STRONG" | "PARTIAL" | "MISSING";

export type RiskLevel = "LOW" | "MEDIUM" | "HIGH" | "UNKNOWN";

export type DeterministicMaterialScoreInput = Readonly<{
  criterion: string;
  maxScore: number;
  evidenceStrength: EvidenceStrength | null | undefined;
  riskLevel?: RiskLevel | null;
}>;

export type DeterministicMaterialScoreResult = Readonly<{
  criterion: string;
  maxScore: number;
  evidenceStrength: EvidenceStrength;
  riskLevel: RiskLevel;
  mappedScore: number;
}>;

export const DEFAULT_COMPOSITE_SCORE_WEIGHTS: ScoreWeights = {
  material: 0.7,
  performance: 0.3,
};

const EVIDENCE_STRENGTH_BASE_RATIO: Record<EvidenceStrength, number> = {
  MISSING: 0.1,
  PARTIAL: 0.45,
  STRONG: 0.8,
};

const RISK_LEVEL_ADJUSTMENT: Record<RiskLevel, number> = {
  HIGH: -0.2,
  MEDIUM: -0.1,
  UNKNOWN: -0.05,
  LOW: 0.05,
};

function assertValidScore(value: number, fieldName: string) {
  if (!Number.isFinite(value) || value < 0 || value > 100) {
    throw new Error(`${fieldName} must be a number from 0 to 100.`);
  }
}

function normalizeWeights(weights: Partial<ScoreWeights> = {}): ScoreWeights {
  const material = weights.material ?? DEFAULT_COMPOSITE_SCORE_WEIGHTS.material;
  const performance =
    weights.performance ?? DEFAULT_COMPOSITE_SCORE_WEIGHTS.performance;
  const total = material + performance;

  if (!Number.isFinite(material) || material < 0) {
    throw new Error("material weight must be a non-negative number.");
  }

  if (!Number.isFinite(performance) || performance < 0) {
    throw new Error("performance weight must be a non-negative number.");
  }

  if (total <= 0) {
    throw new Error("score weights must sum to more than 0.");
  }

  return {
    material: material / total,
    performance: performance / total,
  };
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function normalizeEvidenceStrength(
  value: EvidenceStrength | null | undefined,
): EvidenceStrength {
  return value === "STRONG" || value === "PARTIAL" || value === "MISSING"
    ? value
    : "MISSING";
}

function normalizeRiskLevel(value: RiskLevel | null | undefined): RiskLevel {
  return value === "LOW" ||
    value === "MEDIUM" ||
    value === "HIGH" ||
    value === "UNKNOWN"
    ? value
    : "UNKNOWN";
}

function isBarrierCriterion(criterion: string) {
  return criterion === "进入壁垒";
}

export function deriveDeterministicMaterialScore({
  criterion,
  maxScore,
  evidenceStrength,
  riskLevel,
}: DeterministicMaterialScoreInput): DeterministicMaterialScoreResult {
  if (!Number.isFinite(maxScore) || maxScore <= 0) {
    throw new Error("maxScore must be a positive number.");
  }

  const normalizedEvidenceStrength = normalizeEvidenceStrength(evidenceStrength);
  const normalizedRiskLevel = normalizeRiskLevel(riskLevel);
  const ratio = clamp(
    EVIDENCE_STRENGTH_BASE_RATIO[normalizedEvidenceStrength] +
      RISK_LEVEL_ADJUSTMENT[normalizedRiskLevel],
    0,
    1,
  );
  let mappedScore = Math.round(maxScore * ratio);

  if (isBarrierCriterion(criterion)) {
    if (normalizedEvidenceStrength === "MISSING") {
      mappedScore = Math.min(mappedScore, 2);
    } else if (normalizedEvidenceStrength === "PARTIAL") {
      mappedScore = Math.min(mappedScore, 5);
    }
  }

  return {
    criterion,
    maxScore,
    evidenceStrength: normalizedEvidenceStrength,
    riskLevel: normalizedRiskLevel,
    mappedScore,
  };
}

export function deriveCompositeScore({
  materialScore,
  performanceScore,
  weights,
}: CompositeScoreInput): CompositeScoreResult | null {
  if (materialScore === null || materialScore === undefined) return null;
  if (performanceScore === null || performanceScore === undefined) return null;

  assertValidScore(materialScore, "materialScore");
  assertValidScore(performanceScore, "performanceScore");

  const normalizedWeights = normalizeWeights(weights);
  const compositeScore = Math.round(
    materialScore * normalizedWeights.material +
      performanceScore * normalizedWeights.performance,
  );

  return {
    materialScore,
    performanceScore,
    compositeScore,
    weights: normalizedWeights,
  };
}
