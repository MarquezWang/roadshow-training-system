UPDATE "TrainingAnalysis"
SET
  "promptVersion" = CASE
    WHEN "promptVersion" = '' THEN 'legacy-unknown'
    ELSE "promptVersion"
  END,
  "schemaVersion" = CASE
    WHEN "schemaVersion" = '' THEN 'legacy-unknown'
    ELSE "schemaVersion"
  END,
  "modelVersion" = CASE
    WHEN "modelVersion" = '' THEN 'legacy-unknown'
    ELSE "modelVersion"
  END,
  "ruleVersion" = CASE
    WHEN "ruleVersion" = '' THEN 'legacy-unknown'
    ELSE "ruleVersion"
  END
WHERE "status" = 'COMPLETED';
