export type CriterionInput = {
  category: string | null;
  name: string;
  weight: number;
};

export type Evidence = {
  evidenceText: string;
  evidenceLocation: string;
};

export type EvidenceStrength = "STRONG" | "PARTIAL" | "MISSING";
export type RiskLevel = "LOW" | "MEDIUM" | "HIGH" | "UNKNOWN";
export type UnsupportedNumericClaimField =
  | "reason"
  | "deductionReason"
  | "suggestion";
export type ValidationWarning =
  | string
  | {
      type: "normalizedUnsupportedNumericClaim";
      criterion: string;
      fields: UnsupportedNumericClaimField[];
    };

export type ValidatedScoreResult = {
  totalScore: number;
  categoryScores: Array<{
    category: string;
    maxScore: number;
    score: number;
    reason: string;
  }>;
  scoreItems: Array<{
    category: string;
    criterion: string;
    maxScore: number;
    score: number;
    aiSuggestedScore?: number;
    reason: string;
    deductionReason: string;
    suggestion: string;
    evidenceStrength: EvidenceStrength;
    riskLevel: RiskLevel;
    evidence: Evidence;
  }>;
  overallComment: string;
  scoreWarnings: ValidationWarning[];
  normalizedEvidenceItems: string[];
};

export type ValidatedScoreItem = ValidatedScoreResult["scoreItems"][number];
