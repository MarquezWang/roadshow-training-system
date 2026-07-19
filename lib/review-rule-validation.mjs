function assertString(value, fieldName, maxLength = 500) {
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`${fieldName} 必须是非空字符串。`);
  }

  const normalized = value.trim();
  if (normalized.length > maxLength) {
    throw new Error(`${fieldName} 不能超过 ${maxLength} 个字符。`);
  }
  return normalized;
}

function assertPositiveInteger(value, fieldName) {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`${fieldName} 必须是正整数。`);
  }

  return value;
}

export function validateEvaluationRule(rule) {
  if (!rule || typeof rule !== "object" || Array.isArray(rule)) {
    throw new Error("评审规则必须是 JSON 对象。");
  }

  const name = assertString(rule.name, "name", 200);
  const contestName = assertString(rule.contestName, "contestName", 200);
  const version = assertString(rule.version, "version", 100);
  const totalScore = assertPositiveInteger(rule.totalScore, "totalScore");

  if (totalScore !== 100) {
    throw new Error(`totalScore 必须等于 100，当前为 ${totalScore}。`);
  }
  if (!Array.isArray(rule.criteria) || rule.criteria.length === 0) {
    throw new Error("criteria 必须是非空数组。");
  }
  if (rule.criteria.length > 100) {
    throw new Error("criteria 不能超过 100 项。");
  }

  const names = new Set();
  const sortOrders = new Set();
  const criteria = rule.criteria.map((criterion, index) => {
    if (!criterion || typeof criterion !== "object" || Array.isArray(criterion)) {
      throw new Error(`criteria[${index}] 必须是对象。`);
    }

    const criterionName = assertString(
      criterion.name,
      `criteria[${index}].name`,
      200,
    );
    const normalizedName = criterionName.toLocaleLowerCase("zh-CN");
    if (names.has(normalizedName)) {
      throw new Error(`指标名称重复：${criterionName}。`);
    }
    names.add(normalizedName);

    const sortOrder = assertPositiveInteger(
      criterion.sortOrder,
      `criteria[${index}].sortOrder`,
    );
    if (sortOrders.has(sortOrder)) {
      throw new Error(`sortOrder 重复：${sortOrder}。`);
    }
    sortOrders.add(sortOrder);

    return {
      category:
        typeof criterion.category === "string" && criterion.category.trim()
          ? assertString(
              criterion.category,
              `criteria[${index}].category`,
              200,
            )
          : null,
      name: criterionName,
      weight: assertPositiveInteger(
        criterion.weight,
        `criteria[${index}].weight`,
      ),
      description: assertString(
        criterion.description,
        `criteria[${index}].description`,
        5_000,
      ),
      scoringGuide:
        typeof criterion.scoringGuide === "string" &&
        criterion.scoringGuide.trim()
          ? assertString(
              criterion.scoringGuide,
              `criteria[${index}].scoringGuide`,
              5_000,
            )
          : null,
      sortOrder,
    };
  });

  const criteriaWeightTotal = criteria.reduce(
    (sum, criterion) => sum + criterion.weight,
    0,
  );
  if (criteriaWeightTotal !== totalScore) {
    throw new Error(
      `criteria weight 总和必须等于 ${totalScore}，当前为 ${criteriaWeightTotal}。`,
    );
  }

  return {
    name,
    contestName,
    version,
    totalScore,
    description:
      typeof rule.description === "string" && rule.description.trim()
        ? assertString(rule.description, "description", 5_000)
        : null,
    rawText:
      typeof rule.rawText === "string" && rule.rawText.trim()
        ? assertString(rule.rawText, "rawText", 100_000)
        : JSON.stringify(rule, null, 2),
    criteria,
    criteriaWeightTotal,
  };
}
