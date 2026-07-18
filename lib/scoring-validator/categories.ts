import type {
  CriterionInput,
  ValidatedScoreResult,
} from "./types";

export function normalizeCategory(category: string | null) {
  return category || "未分类";
}

export function sumByCategory(criteria: CriterionInput[]) {
  return criteria.reduce<Record<string, number>>((result, criterion) => {
    const category = normalizeCategory(criterion.category);
    result[category] = (result[category] ?? 0) + criterion.weight;
    return result;
  }, {});
}

export function assertMappedScoreInvariants(
  scoreItems: ValidatedScoreResult["scoreItems"],
  totalScore: number,
  criteriaCount: number,
) {
  if (scoreItems.length !== criteriaCount) {
    throw new Error(
      `mapped scoreItems 数量应为 ${criteriaCount}，当前为 ${scoreItems.length}。`,
    );
  }

  const scoreItemsTotal = scoreItems.reduce(
    (sum, item) => sum + item.score,
    0,
  );
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
