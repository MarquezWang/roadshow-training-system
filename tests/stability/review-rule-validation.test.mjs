import assert from "node:assert/strict";
import test from "node:test";

import { validateEvaluationRule } from "../../lib/review-rule-validation.mjs";

function validRule() {
  return {
    name: "测试规则",
    contestName: "测试赛事",
    version: "v1",
    totalScore: 100,
    criteria: [
      {
        name: "技术",
        weight: 60,
        description: "技术证据",
        sortOrder: 1,
      },
      {
        name: "市场",
        weight: 40,
        description: "市场证据",
        sortOrder: 2,
      },
    ],
  };
}

test("review rule validation accepts deterministic positive criteria", () => {
  const rule = validateEvaluationRule(validRule());
  assert.equal(rule.criteriaWeightTotal, 100);
  assert.deepEqual(
    rule.criteria.map((criterion) => criterion.sortOrder),
    [1, 2],
  );
});

test("review rule validation rejects duplicate names and sort orders", () => {
  const duplicateName = validRule();
  duplicateName.criteria[1].name = "技术";
  assert.throws(() => validateEvaluationRule(duplicateName), /指标名称重复/);

  const duplicateSort = validRule();
  duplicateSort.criteria[1].sortOrder = 1;
  assert.throws(() => validateEvaluationRule(duplicateSort), /sortOrder 重复/);
});

test("review rule validation rejects fractional or non-positive scoring values", () => {
  const fractional = validRule();
  fractional.criteria[0].weight = 60.5;
  assert.throws(() => validateEvaluationRule(fractional), /必须是正整数/);

  const nonPositive = validRule();
  nonPositive.criteria[0].sortOrder = 0;
  assert.throws(() => validateEvaluationRule(nonPositive), /必须是正整数/);
});
