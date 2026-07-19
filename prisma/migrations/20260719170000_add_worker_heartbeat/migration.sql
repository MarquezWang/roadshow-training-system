-- Independent background workers publish short-lived database heartbeats so
-- the web process and production checks can distinguish a live worker from a
-- merely configured one.
CREATE TABLE "WorkerHeartbeat" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "workerType" TEXT NOT NULL DEFAULT 'BACKGROUND' CHECK ("workerType" IN ('BACKGROUND')),
    "hostname" TEXT NOT NULL,
    "processId" INTEGER NOT NULL,
    "capabilitiesJson" TEXT NOT NULL,
    "capabilitiesSchemaVersion" TEXT NOT NULL DEFAULT 'worker-capabilities:v1',
    "startedAt" DATETIME NOT NULL,
    "lastSeenAt" DATETIME NOT NULL,
    "expiresAt" DATETIME NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

CREATE INDEX "WorkerHeartbeat_workerType_expiresAt_idx"
ON "WorkerHeartbeat"("workerType", "expiresAt");
