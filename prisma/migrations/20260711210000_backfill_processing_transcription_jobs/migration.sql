INSERT INTO "AsyncJob" (
  "id",
  "jobKey",
  "jobType",
  "resourceId",
  "status",
  "ownerToken",
  "leaseExpiresAt",
  "attempt",
  "maxAttempts",
  "nextAttemptAt",
  "errorMessage",
  "createdAt",
  "updatedAt"
)
SELECT
  'asr-' || lower(hex(randomblob(16))),
  'training-transcription:' || recording."id",
  'TRAINING_TRANSCRIPTION',
  recording."id",
  'PENDING',
  '',
  NULL,
  0,
  3,
  NULL,
  NULL,
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
FROM "TrainingRecording" AS recording
INNER JOIN "TrainingTranscript" AS transcript
  ON transcript."recordingId" = recording."id"
WHERE transcript."status" = 'PROCESSING'
  AND recording."phase" IN ('PITCH', 'QA')
  AND NOT EXISTS (
    SELECT 1
    FROM "AsyncJob" AS existing
    WHERE existing."jobKey" = 'training-transcription:' || recording."id"
  );
