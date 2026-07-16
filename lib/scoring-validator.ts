import { deriveDeterministicMaterialScore } from "@/lib/scoring-v2";
import { isRecord } from "@/lib/type-guards";

type CriterionInput = {
  category: string | null;
  name: string;
  weight: number;
};

type Evidence = {
  evidenceText: string;
  evidenceLocation: string;
};

type EvidenceStrength = "STRONG" | "PARTIAL" | "MISSING";
type RiskLevel = "LOW" | "MEDIUM" | "HIGH" | "UNKNOWN";
type UnsupportedNumericClaimField = "reason" | "deductionReason" | "suggestion";
type ValidationWarning =
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

const factPattern =
  /(\d+(\.\d+)?\s*(年|月|日|万元|亿元|元|%|％|亩|项|件|个|家|省|市|页|轮|次|吨|公斤|kg|KG|m²|㎡|万|亿)?)|([一二三四五六七八九十百千万亿]+(年|月|项|件|个|家|省|市|轮|次))/;
const normalizedMissingEvidenceText = "材料未提供相关证据。";

function assertString(value: unknown, fieldName: string) {
  if (typeof value !== "string") {
    throw new Error(`评分 JSON 字段 ${fieldName} 必须是字符串。`);
  }

  return value;
}

function assertNonEmptyString(value: unknown, fieldName: string) {
  const text = assertString(value, fieldName).trim();

  if (!text) {
    throw new Error(`评分 JSON 字段 ${fieldName} 不能为空。`);
  }

  return text;
}

function assertInteger(value: unknown, fieldName: string) {
  if (typeof value !== "number" || !Number.isInteger(value)) {
    throw new Error(`评分 JSON 字段 ${fieldName} 必须是整数。`);
  }

  return value;
}

function assertOptionalInteger(value: unknown, fieldName: string) {
  if (value === undefined || value === null) {
    return undefined;
  }

  return assertInteger(value, fieldName);
}

function assertStringArray(value: unknown, fieldName: string) {
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) {
    throw new Error(`评分 JSON 字段 ${fieldName} 必须是字符串数组。`);
  }

  return value;
}

function normalizeCategory(category: string | null) {
  return category || "未分类";
}

function sumByCategory(criteria: CriterionInput[]) {
  return criteria.reduce<Record<string, number>>((result, criterion) => {
    const category = normalizeCategory(criterion.category);
    result[category] = (result[category] ?? 0) + criterion.weight;
    return result;
  }, {});
}

function assertExactNumber(
  actual: number,
  expected: number,
  fieldName: string,
) {
  if (actual !== expected) {
    throw new Error(`${fieldName} 应为 ${expected}，当前为 ${actual}。`);
  }
}

function hasSpecificFact(text: string) {
  return factPattern.test(text);
}

function parseEvidence(value: unknown, fieldName: string): Evidence {
  if (!isRecord(value)) {
    throw new Error(`评分 JSON 字段 ${fieldName} 必须是对象。`);
  }

  return {
    evidenceText: assertNonEmptyString(
      value.evidenceText,
      `${fieldName}.evidenceText`,
    ),
    evidenceLocation:
      typeof value.evidenceLocation === "string"
        ? value.evidenceLocation.trim()
        : "",
  };
}

function parseEvidenceStrength(
  value: unknown,
  fieldName: string,
): EvidenceStrength {
  if (value === undefined || value === null) {
    throw new Error(`评分 JSON 字段 ${fieldName} 不能为空。`);
  }

  if (value !== "STRONG" && value !== "PARTIAL" && value !== "MISSING") {
    throw new Error(
      `评分 JSON 字段 ${fieldName} 必须是 STRONG、PARTIAL 或 MISSING。`,
    );
  }

  return value;
}

function parseRiskLevel(value: unknown, fieldName: string): RiskLevel {
  if (value === undefined || value === null) {
    throw new Error(`评分 JSON 字段 ${fieldName} 不能为空。`);
  }

  if (
    value !== "LOW" &&
    value !== "MEDIUM" &&
    value !== "HIGH" &&
    value !== "UNKNOWN"
  ) {
    throw new Error(
      `评分 JSON 字段 ${fieldName} 必须是 LOW、MEDIUM、HIGH 或 UNKNOWN。`,
    );
  }

  return value;
}

function hasUnsupportedNumericClaim(evidence: Evidence, text: string) {
  return (
    hasSpecificFact(text) &&
    (isMissingEvidenceText(evidence.evidenceText) ||
      !hasSpecificFact(evidence.evidenceText))
  );
}

function normalizeUnsupportedNumericClaims(
  criterion: string,
  evidence: Evidence,
  fields: Record<UnsupportedNumericClaimField, string>,
) {
  const unsupportedFields: UnsupportedNumericClaimField[] = [];
  const normalizedFields = { ...fields };

  for (const field of Object.keys(fields) as UnsupportedNumericClaimField[]) {
    if (!hasUnsupportedNumericClaim(evidence, fields[field])) {
      continue;
    }

    unsupportedFields.push(field);
  }

  if (unsupportedFields.includes("reason")) {
    normalizedFields.reason = "材料证据不足，未采纳无依据的具体数字表述。";
  }

  if (unsupportedFields.includes("deductionReason")) {
    normalizedFields.deductionReason = "材料未提供可核验的具体数量依据。";
  }

  if (unsupportedFields.includes("suggestion")) {
    normalizedFields.suggestion =
      "补充可核验的数量、指标、客户、案例或测试结果依据。";
  }

  return {
    fields: normalizedFields,
    warning:
      unsupportedFields.length > 0
        ? {
            type: "normalizedUnsupportedNumericClaim" as const,
            criterion,
            fields: unsupportedFields,
          }
        : null,
  };
}

function isMissingEvidenceText(text: string) {
  return /材料未提供|未提供相关证据|未提及|未说明|无法判断|依据不足/.test(text);
}

function assertMappedScoreInvariants(
  scoreItems: ValidatedScoreResult["scoreItems"],
  totalScore: number,
  criteriaCount: number,
) {
  if (scoreItems.length !== criteriaCount) {
    throw new Error(
      `mapped scoreItems 数量应为 ${criteriaCount}，当前为 ${scoreItems.length}。`,
    );
  }

  const scoreItemsTotal = scoreItems.reduce((sum, item) => sum + item.score, 0);

  if (totalScore !== scoreItemsTotal) {
    throw new Error(
      `mapped totalScore 应等于 scoreItems[].score 之和 ${scoreItemsTotal}，当前为 ${totalScore}。`,
    );
  }

  const invalidMappedScore = scoreItems.find(
    (item) =>
      !Number.isInteger(item.score) ||
      item.score < 0 ||
      item.score > item.maxScore,
  );

  if (invalidMappedScore) {
    throw new Error(
      `${invalidMappedScore.criterion} 的 mapped score 必须是 0 到 ${invalidMappedScore.maxScore} 之间的整数。`,
    );
  }
}

export function validateScoreResult(
  scoreJson: unknown,
  criteria: CriterionInput[],
): ValidatedScoreResult {
  if (!isRecord(scoreJson)) {
    throw new Error("评分 JSON 顶层结构必须是对象。");
  }

  if (!Array.isArray(scoreJson.scoreItems)) {
    throw new Error("评分 JSON 字段 scoreItems 必须是数组。");
  }

  if (scoreJson.scoreItems.length !== criteria.length) {
    throw new Error(
      `scoreItems 数量应为 ${criteria.length}，当前为 ${scoreJson.scoreItems.length}。`,
    );
  }

  const criteriaByName = new Map(criteria.map((item) => [item.name, item]));
  const seenCriteria = new Set<string>();
  const normalizedMissingEvidenceTextCriteria: string[] = [];
  const validationWarnings: ValidationWarning[] = [];
  const scoreItems = scoreJson.scoreItems.map((item, index) => {
    if (!isRecord(item)) {
      throw new Error(`scoreItems[${index}] 必须是对象。`);
    }

    const criterionName = assertString(item.criterion, `scoreItems[${index}].criterion`);
    const criterion = criteriaByName.get(criterionName);

    if (!criterion) {
      throw new Error(`scoreItems[${index}].criterion 无法匹配评分指标：${criterionName}`);
    }

    if (seenCriteria.has(criterionName)) {
      throw new Error(`scoreItems 中存在重复评分指标：${criterionName}`);
    }

    seenCriteria.add(criterionName);

    const category = assertString(item.category, `scoreItems[${index}].category`);
    const expectedCategory = normalizeCategory(criterion.category);
    const maxScore = assertInteger(item.maxScore, `scoreItems[${index}].maxScore`);
    const aiSuggestedScore = assertOptionalInteger(
      item.aiSuggestedScore ?? item.score,
      `scoreItems[${index}].aiSuggestedScore`,
    );

    if (category !== expectedCategory) {
      throw new Error(
        `scoreItems[${index}].category 应为 ${expectedCategory}，当前为 ${category}。`,
      );
    }

    assertExactNumber(maxScore, criterion.weight, `scoreItems[${index}].maxScore`);

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
    let suggestion = assertString(item.suggestion, `scoreItems[${index}].suggestion`);
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

    if (evidenceStrength === "STRONG" && isMissingEvidenceText(evidence.evidenceText)) {
      throw new Error(
        `scoreItems[${index}].evidenceStrength 为 STRONG 时，evidenceText 不能是缺失证据描述。`,
      );
    }

    if (evidenceStrength === "MISSING" && !isMissingEvidenceText(evidence.evidenceText)) {
      normalizedMissingEvidenceTextCriteria.push(criterionName);
      evidence.evidenceText = normalizedMissingEvidenceText;
    }

    const mappedScore = deriveDeterministicMaterialScore({
      criterion: criterionName,
      maxScore,
      evidenceStrength,
      riskLevel,
    }).mappedScore;

    const numericClaimNormalization = normalizeUnsupportedNumericClaims(
      criterionName,
      evidence,
      {
        reason,
        deductionReason,
        suggestion,
      },
    );
    reason = numericClaimNormalization.fields.reason;
    deductionReason = numericClaimNormalization.fields.deductionReason;
    suggestion = numericClaimNormalization.fields.suggestion;

    if (numericClaimNormalization.warning) {
      validationWarnings.push(numericClaimNormalization.warning);
    }

    return {
      category,
      criterion: criterionName,
      maxScore,
      score: mappedScore,
      ...(aiSuggestedScore !== undefined ? { aiSuggestedScore } : {}),
      reason,
      deductionReason,
      suggestion,
      evidenceStrength,
      riskLevel,
      evidence,
    };
  });

  const missingCriteria = criteria
    .map((criterion) => criterion.name)
    .filter((criterionName) => !seenCriteria.has(criterionName));

  if (missingCriteria.length > 0) {
    throw new Error(`scoreItems 缺少评分指标：${missingCriteria.join("、")}。`);
  }

  const scoreItemsTotal = scoreItems.reduce((sum, item) => sum + item.score, 0);
  assertMappedScoreInvariants(scoreItems, scoreItemsTotal, criteria.length);

  const expectedCategoryMaxScores = sumByCategory(criteria);
  const expectedCategoryScores = scoreItems.reduce<Record<string, number>>(
    (result, item) => {
      result[item.category] = (result[item.category] ?? 0) + item.score;
      return result;
    },
    {},
  );

  const categoryScores = Object.entries(expectedCategoryMaxScores).map(
    ([category, maxScore]) => ({
      category,
      maxScore,
      score: expectedCategoryScores[category] ?? 0,
      reason: "由后端根据 scoreItems 的 evidenceStrength 和 riskLevel 确定性汇总。",
    }),
  );

  const scoreWarnings: ValidationWarning[] = Array.isArray(scoreJson.scoreWarnings)
    ? assertStringArray(scoreJson.scoreWarnings, "scoreWarnings")
    : [];

  if (normalizedMissingEvidenceTextCriteria.length > 0) {
    scoreWarnings.push(
      `normalizedMissingEvidenceText: ${JSON.stringify(
        normalizedMissingEvidenceTextCriteria,
      )}`,
    );
  }

  scoreWarnings.push(...validationWarnings);

  return {
    totalScore: scoreItemsTotal,
    categoryScores,
    scoreItems,
    overallComment:
      typeof scoreJson.overallComment === "string"
        ? scoreJson.overallComment
        : "材料评分由证据强度和风险等级确定性映射生成。",
    scoreWarnings,
    normalizedEvidenceItems: normalizedMissingEvidenceTextCriteria,
  };
}
