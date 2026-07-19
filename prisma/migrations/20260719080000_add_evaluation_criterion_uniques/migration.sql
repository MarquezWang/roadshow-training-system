-- Enforce deterministic, non-ambiguous criterion identity within each rule.
CREATE UNIQUE INDEX "EvaluationCriterion_ruleId_sortOrder_key"
ON "EvaluationCriterion"("ruleId", "sortOrder");

CREATE UNIQUE INDEX "EvaluationCriterion_ruleId_name_key"
ON "EvaluationCriterion"("ruleId", "name");

-- Both unique indexes have ruleId as their leading column, so the old
-- single-column index is redundant and is not part of the Prisma data model.
DROP INDEX "EvaluationCriterion_ruleId_idx";
