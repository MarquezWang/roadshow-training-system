type CriterionInput = {
  category: string | null;
  name: string;
  weight: number;
};

type Evidence = {
  evidenceText: string;
  evidenceLocation: string;
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
    reason: string;
    deductionReason: string;
    suggestion: string;
    evidence: Evidence;
  }>;
  overallComment: string;
  scoreWarnings: string[];
};

const factPattern =
  /(\d+(\.\d+)?\s*(年|月|日|万元|亿元|元|%|％|亩|项|件|个|家|省|市|页|轮|次|吨|公斤|kg|KG|m²|㎡|万|亿)?)|([一二三四五六七八九十百千万亿]+(年|月|项|件|个|家|省|市|轮|次))/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

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

function assertEvidenceForFacts(
  evidence: Evidence,
  text: string,
  fieldName: string,
) {
  if (!hasSpecificFact(text)) {
    return;
  }

  if (evidence.evidenceText === "材料未提供相关证据") {
    throw new Error(
      `${fieldName} 包含具体数字或数量，但 evidenceText 未提供材料依据。`,
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

  const totalScore = assertInteger(scoreJson.totalScore, "totalScore");

  if (!Array.isArray(scoreJson.scoreItems)) {
    throw new Error("评分 JSON 字段 scoreItems 必须是数组。");
  }

  if (!Array.isArray(scoreJson.categoryScores)) {
    throw new Error("评分 JSON 字段 categoryScores 必须是数组。");
  }

  if (scoreJson.scoreItems.length !== criteria.length) {
    throw new Error(
      `scoreItems 数量应为 ${criteria.length}，当前为 ${scoreJson.scoreItems.length}。`,
    );
  }

  const criteriaByName = new Map(criteria.map((item) => [item.name, item]));
  const seenCriteria = new Set<string>();
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
    const score = assertInteger(item.score, `scoreItems[${index}].score`);

    if (category !== expectedCategory) {
      throw new Error(
        `scoreItems[${index}].category 应为 ${expectedCategory}，当前为 ${category}。`,
      );
    }

    assertExactNumber(maxScore, criterion.weight, `scoreItems[${index}].maxScore`);

    if (score < 0 || score > maxScore) {
      throw new Error(
        `scoreItems[${index}].score 必须在 0 到 ${maxScore} 之间，当前为 ${score}。`,
      );
    }

    const reason = assertString(item.reason, `scoreItems[${index}].reason`);
    const deductionReason = assertString(
      item.deductionReason,
      `scoreItems[${index}].deductionReason`,
    );
    const suggestion = assertString(item.suggestion, `scoreItems[${index}].suggestion`);
    const evidence = parseEvidence(
      item.evidence,
      `scoreItems[${index}].evidence`,
    );

    assertEvidenceForFacts(evidence, reason, `scoreItems[${index}].reason`);
    assertEvidenceForFacts(
      evidence,
      deductionReason,
      `scoreItems[${index}].deductionReason`,
    );

    return {
      category,
      criterion: criterionName,
      maxScore,
      score,
      reason,
      deductionReason,
      suggestion,
      evidence,
    };
  });

  const scoreItemsTotal = scoreItems.reduce((sum, item) => sum + item.score, 0);
  assertExactNumber(totalScore, scoreItemsTotal, "totalScore");

  const expectedCategoryMaxScores = sumByCategory(criteria);
  const expectedCategoryScores = scoreItems.reduce<Record<string, number>>(
    (result, item) => {
      result[item.category] = (result[item.category] ?? 0) + item.score;
      return result;
    },
    {},
  );

  const categoryScores = scoreJson.categoryScores.map((item, index) => {
    if (!isRecord(item)) {
      throw new Error(`categoryScores[${index}] 必须是对象。`);
    }

    const category = assertString(item.category, `categoryScores[${index}].category`);
    const maxScore = assertInteger(item.maxScore, `categoryScores[${index}].maxScore`);
    const score = assertInteger(item.score, `categoryScores[${index}].score`);
    const expectedMaxScore = expectedCategoryMaxScores[category];

    if (expectedMaxScore === undefined) {
      throw new Error(`categoryScores[${index}].category 无法匹配一级指标：${category}`);
    }

    assertExactNumber(maxScore, expectedMaxScore, `categoryScores[${index}].maxScore`);
    assertExactNumber(
      score,
      expectedCategoryScores[category] ?? 0,
      `categoryScores[${index}].score`,
    );

    return {
      category,
      maxScore,
      score,
      reason: assertString(item.reason, `categoryScores[${index}].reason`),
    };
  });

  if (categoryScores.length !== Object.keys(expectedCategoryMaxScores).length) {
    throw new Error(
      `categoryScores 数量应为 ${Object.keys(expectedCategoryMaxScores).length}，当前为 ${categoryScores.length}。`,
    );
  }

  return {
    totalScore,
    categoryScores,
    scoreItems,
    overallComment: assertString(scoreJson.overallComment, "overallComment"),
    scoreWarnings: assertStringArray(scoreJson.scoreWarnings, "scoreWarnings"),
  };
}
