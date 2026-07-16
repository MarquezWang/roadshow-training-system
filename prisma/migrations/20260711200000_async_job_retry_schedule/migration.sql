ALTER TABLE "AsyncJob" ADD COLUMN "maxAttempts" INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "AsyncJob" ADD COLUMN "nextAttemptAt" DATETIME;

CREATE INDEX "AsyncJob_jobType_status_nextAttemptAt_idx"
ON "AsyncJob"("jobType", "status", "nextAttemptAt");
