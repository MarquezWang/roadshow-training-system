ALTER TABLE "TrainingAnalysis"
ADD COLUMN "isFallback" BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE "TrainingAnalysis"
ADD COLUMN "fallbackReason" TEXT;

UPDATE "TrainingAnalysis"
SET
  "isFallback" = true,
  "fallbackReason" = CASE
    WHEN "summary" LIKE '%转写文本不可用%'
      OR "summary" LIKE '%缺少可分析的转写或回答文本%'
      THEN 'NO_ANALYZABLE_TEXT'
    WHEN "summary" LIKE '%AI 未返回有效内容%'
      OR "errorMessage" LIKE '%AI 返回内容为空%'
      THEN 'AI_EMPTY_CONTENT'
    WHEN "summary" LIKE '%结构化输出不符合报告 Schema%'
      OR "errorMessage" LIKE '%结构化输出不符合报告 Schema%'
      OR "rawResultJson" LIKE '%STRUCTURED_OUTPUT_INVALID_AFTER_REPAIR%'
      THEN 'STRUCTURED_OUTPUT_INVALID'
    ELSE 'LEGACY_INFERRED_FALLBACK'
  END
WHERE "summary" LIKE '%当前报告为降级版本%'
  OR "summary" LIKE '%系统已生成降级报告%'
  OR "summary" LIKE '%系统已生成基础报告%'
  OR "errorMessage" LIKE '%已生成降级报告%'
  OR "rawResultJson" LIKE '%STRUCTURED_OUTPUT_INVALID_AFTER_REPAIR%'
  OR "rawResultJson" LIKE '%RETRY_WITHOUT_JSON_MODE_EMPTY_CONTENT%';
