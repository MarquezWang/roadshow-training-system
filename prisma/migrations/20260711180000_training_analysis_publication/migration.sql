ALTER TABLE "TrainingSession"
ADD COLUMN "currentAnalysisId" TEXT
REFERENCES "TrainingAnalysis"("id") ON DELETE SET NULL;

ALTER TABLE "TrainingAnalysis" ADD COLUMN "promptVersion" TEXT NOT NULL DEFAULT '';
ALTER TABLE "TrainingAnalysis" ADD COLUMN "schemaVersion" TEXT NOT NULL DEFAULT '';
ALTER TABLE "TrainingAnalysis" ADD COLUMN "modelVersion" TEXT NOT NULL DEFAULT '';
ALTER TABLE "TrainingAnalysis" ADD COLUMN "ruleVersion" TEXT NOT NULL DEFAULT '';

UPDATE "TrainingSession"
SET "currentAnalysisId" = (
  SELECT "id"
  FROM "TrainingAnalysis"
  WHERE "TrainingAnalysis"."sessionId" = "TrainingSession"."id"
    AND "TrainingAnalysis"."analysisType" = 'PITCH'
    AND "TrainingAnalysis"."status" = 'COMPLETED'
  ORDER BY "TrainingAnalysis"."createdAt" DESC, "TrainingAnalysis"."id" DESC
  LIMIT 1
);

CREATE UNIQUE INDEX "TrainingSession_currentAnalysisId_key"
ON "TrainingSession"("currentAnalysisId");
