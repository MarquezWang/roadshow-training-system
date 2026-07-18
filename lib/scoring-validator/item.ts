import { deriveDeterministicMaterialScore } from "@/lib/scoring-v2";
import {
  isMissingEvidenceText,
  normalizeUnsupportedNumericClaims,
  NORMALIZED_MISSING_EVIDENCE_TEXT,
  parseEvidence,
  parseEvidenceStrength,
  parseRiskLevel,
} from "./evidence";
import {
  assertExactNumber,
  assertInteger,
  assertOptionalInteger,
  assertString,
} from "./primitives";
import { normalizeCategory } from "./categories";
import type {
  CriterionInput,
  ValidatedScoreItem,
} from "./types";

export function validateScoreItemFields(
  item: Record<string, unknown>,
  index: number,
  criterion: CriterionInput,
) {
  const category = assertString(
    item.category,
    `scoreItems[${index}].category`,
  );
  const expectedCategory = normalizeCategory(criterion.category);
  const maxScore = assertInteger(
    item.maxScore,
    `scoreItems[${index}].maxScore`,
  );
  const aiSuggestedScore = assertOptionalInteger(
    item.aiSuggestedScore ?? item.score,
    `scoreItems[${index}].aiSuggestedScore`,
  );

  if (category !== expectedCategory) {
    throw new Error(
      `scoreItems[${index}].category 应为 ${expectedCategory}，当前为 ${category}。`,
    );
  }
  assertExactNumber(
    maxScore,
    criterion.weight,
    `scoreItems[${index}].maxScore`,
  );
  if (
    aiSuggestedScore !== undefined &&
    (aiSuggestedScore < 0 || aiSuggestedScore > maxScore)
  ) {
    throw new Error(
      `scoreItems[${index}].aiSuggestedScore 必须在 0 到 ${maxScore} 之间，当前为 ${aiSuggestedScore}。`,
    );
  }

  let reason = assertString(item.reason, `scoreItems[${index}].reason`);
  let deductionReason = assertString(
    item.deductionReason,
    `scoreItems[${index}].deductionReason`,
  );
  let suggestion = assertString(
    item.suggestion,
    `scoreItems[${index}].suggestion`,
  );
  const evidenceStrength = parseEvidenceStrength(
    item.evidenceStrength,
    `scoreItems[${index}].evidenceStrength`,
  );
  const riskLevel = parseRiskLevel(
    item.riskLevel,
    `scoreItems[${index}].riskLevel`,
  );
  const evidence = parseEvidence(
    item.evidence,
    `scoreItems[${index}].evidence`,
  );

  if (
    evidenceStrength === "STRONG" &&
    isMissingEvidenceText(evidence.evidenceText)
  ) {
    throw new Error(
      `scoreItems[${index}].evidenceStrength 为 STRONG 时，evidenceText 不能是缺失证据描述。`,
    );
  }

  const normalizedMissingEvidenceText =
    evidenceStrength === "MISSING" &&
    !isMissingEvidenceText(evidence.evidenceText);
  if (normalizedMissingEvidenceText) {
    evidence.evidenceText = NORMALIZED_MISSING_EVIDENCE_TEXT;
  }

  const score = deriveDeterministicMaterialScore({
    criterion: criterion.name,
    maxScore,
    evidenceStrength,
    riskLevel,
  }).mappedScore;
  const numericClaimNormalization = normalizeUnsupportedNumericClaims(
    criterion.name,
    evidence,
    { reason, deductionReason, suggestion },
  );
  reason = numericClaimNormalization.fields.reason;
  deductionReason = numericClaimNormalization.fields.deductionReason;
  suggestion = numericClaimNormalization.fields.suggestion;

  const scoreItem: ValidatedScoreItem = {
    category,
    criterion: criterion.name,
    maxScore,
    score,
    ...(aiSuggestedScore !== undefined ? { aiSuggestedScore } : {}),
    reason,
    deductionReason,
    suggestion,
    evidenceStrength,
    riskLevel,
    evidence,
  };

  return {
    scoreItem,
    normalizedMissingEvidenceText,
    warning: numericClaimNormalization.warning,
  };
}
