import { isRecord } from "@/lib/type-guards";
import {
  assertMappedScoreInvariants,
  sumByCategory,
} from "./categories";
import { validateScoreItemFields } from "./item";
import { assertString, assertStringArray } from "./primitives";
import type {
  CriterionInput,
  ValidatedScoreResult,
  ValidationWarning,
} from "./types";

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

    const criterionName = assertString(
      item.criterion,
      `scoreItems[${index}].criterion`,
    );
    const criterion = criteriaByName.get(criterionName);
    if (!criterion) {
      throw new Error(
        `scoreItems[${index}].criterion 无法匹配评分指标：${criterionName}`,
      );
    }
    if (seenCriteria.has(criterionName)) {
      throw new Error(`scoreItems 中存在重复评分指标：${criterionName}`);
    }
    seenCriteria.add(criterionName);

    const validated = validateScoreItemFields(item, index, criterion);
    if (validated.normalizedMissingEvidenceText) {
      normalizedMissingEvidenceTextCriteria.push(criterionName);
    }
    if (validated.warning) {
      validationWarnings.push(validated.warning);
    }
    return validated.scoreItem;
  });

  const missingCriteria = criteria
    .map((criterion) => criterion.name)
    .filter((criterionName) => !seenCriteria.has(criterionName));
  if (missingCriteria.length > 0) {
    throw new Error(`scoreItems 缺少评分指标：${missingCriteria.join("、")}。`);
  }

  const totalScore = scoreItems.reduce((sum, item) => sum + item.score, 0);
  assertMappedScoreInvariants(scoreItems, totalScore, criteria.length);

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

  const scoreWarnings: ValidationWarning[] = Array.isArray(
    scoreJson.scoreWarnings,
  )
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
    totalScore,
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
