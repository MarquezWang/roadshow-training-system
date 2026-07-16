CREATE TABLE "AsyncJob" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "jobKey" TEXT NOT NULL,
  "jobType" TEXT NOT NULL,
  "resourceId" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'RUNNING',
  "ownerToken" TEXT NOT NULL,
  "leaseExpiresAt" DATETIME,
  "attempt" INTEGER NOT NULL DEFAULT 1,
  "errorMessage" TEXT,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL
);

CREATE UNIQUE INDEX "AsyncJob_jobKey_key" ON "AsyncJob"("jobKey");
CREATE INDEX "AsyncJob_jobType_resourceId_idx" ON "AsyncJob"("jobType", "resourceId");
CREATE INDEX "AsyncJob_status_leaseExpiresAt_idx" ON "AsyncJob"("status", "leaseExpiresAt");
