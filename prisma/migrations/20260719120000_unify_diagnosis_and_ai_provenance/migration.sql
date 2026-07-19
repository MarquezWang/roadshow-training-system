-- Add a complete provenance contract to the canonical diagnosis result.
ALTER TABLE "TrainingSession" ADD COLUMN "contextSchemaVersion" TEXT NOT NULL DEFAULT 'project-ai-context:legacy-v0';
ALTER TABLE "TrainingTranscript" ADD COLUMN "segmentsSchemaVersion" TEXT NOT NULL DEFAULT 'training-transcript-segments:legacy-v0';

ALTER TABLE "MaterialDiagnosis" ADD COLUMN "rawResultJson" TEXT NOT NULL DEFAULT '{}';
ALTER TABLE "MaterialDiagnosis" ADD COLUMN "promptVersion" TEXT NOT NULL DEFAULT 'legacy-unknown';
ALTER TABLE "MaterialDiagnosis" ADD COLUMN "schemaVersion" TEXT NOT NULL DEFAULT 'legacy-unknown';
ALTER TABLE "MaterialDiagnosis" ADD COLUMN "modelVersion" TEXT NOT NULL DEFAULT 'legacy-unknown';

UPDATE "MaterialDiagnosis"
SET
  "promptVersion" = 'legacy-unknown',
  "schemaVersion" = 'material-diagnosis-result:legacy-v0',
  "modelVersion" = 'legacy-unknown',
  "ruleVersion" = CASE
    WHEN "ruleVersion" = '' THEN 'legacy-unknown'
    ELSE "ruleVersion"
  END;

-- Preserve every legacy Diagnosis field in rawResultJson while moving the row
-- into the one canonical diagnosis table. The compatibility parser translates
-- this payload for current readers.
INSERT INTO "MaterialDiagnosis" (
  "id",
  "projectId",
  "ruleName",
  "totalWeight",
  "readinessLevel",
  "readinessScore",
  "summary",
  "strengths",
  "weaknesses",
  "priorityTasks",
  "judgeQuestions",
  "criteriaResults",
  "rawResultJson",
  "inputHash",
  "promptVersion",
  "schemaVersion",
  "modelVersion",
  "ruleVersion",
  "createdAt",
  "updatedAt"
)
SELECT
  'legacy-diagnosis:' || "id",
  "projectId",
  '旧版材料诊断（已迁移）',
  0,
  'INSUFFICIENT',
  NULL,
  "summary",
  '[]',
  '[]',
  '[]',
  '[]',
  '[]',
  json_object(
    'projectSummary', "summary",
    'materialCompleteness', "completeness",
    'issuesJson', "issues",
    'risksJson', "risks",
    'suggestionsJson', "suggestions"
  ),
  '',
  'legacy-unknown',
  'diagnosis-result:legacy-v1',
  'legacy-unknown',
  'legacy-unknown',
  "createdAt",
  "updatedAt"
FROM "Diagnosis";

DROP TABLE "Diagnosis";

-- Persist the same provenance contract for material scoring.
ALTER TABLE "ScoreResult" ADD COLUMN "inputHash" TEXT NOT NULL DEFAULT '';
ALTER TABLE "ScoreResult" ADD COLUMN "promptVersion" TEXT NOT NULL DEFAULT 'legacy-unknown';
ALTER TABLE "ScoreResult" ADD COLUMN "schemaVersion" TEXT NOT NULL DEFAULT 'legacy-unknown';
ALTER TABLE "ScoreResult" ADD COLUMN "modelVersion" TEXT NOT NULL DEFAULT 'legacy-unknown';
ALTER TABLE "ScoreResult" ADD COLUMN "ruleVersion" TEXT NOT NULL DEFAULT 'legacy-unknown';

UPDATE "ScoreResult"
SET
  "schemaVersion" = 'material-score-detail:legacy-v0',
  "ruleVersion" = COALESCE(
    (SELECT "version" FROM "EvaluationRule" WHERE "EvaluationRule"."id" = "ScoreResult"."ruleId"),
    'legacy-unknown'
  );
