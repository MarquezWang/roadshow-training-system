-- Persist versioned job parameters so a standalone worker can execute the
-- exact request semantics after the originating Web request has returned.
ALTER TABLE "AsyncJob"
ADD COLUMN "payloadJson" TEXT;

ALTER TABLE "AsyncJob"
ADD COLUMN "payloadSchemaVersion" TEXT NOT NULL DEFAULT 'async-job-payload:v1';
