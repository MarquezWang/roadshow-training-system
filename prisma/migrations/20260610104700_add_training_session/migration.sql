-- CreateTable
CREATE TABLE "TrainingSession" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "projectId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'CREATED',
    "pitchStartedAt" DATETIME,
    "pitchEndedAt" DATETIME,
    "pitchDurationSec" INTEGER,
    "qaStartedAt" DATETIME,
    "qaEndedAt" DATETIME,
    "qaDurationSec" INTEGER,
    "currentPageIndex" INTEGER NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "TrainingSession_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "SlideEvent" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "sessionId" TEXT NOT NULL,
    "fileId" TEXT,
    "pageIndex" INTEGER NOT NULL,
    "eventType" TEXT NOT NULL,
    "elapsedSec" INTEGER NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "SlideEvent_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "TrainingSession" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "SlideEvent_fileId_fkey" FOREIGN KEY ("fileId") REFERENCES "FileAsset" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "TrainingSession_projectId_idx" ON "TrainingSession"("projectId");

-- CreateIndex
CREATE INDEX "TrainingSession_status_idx" ON "TrainingSession"("status");

-- CreateIndex
CREATE INDEX "SlideEvent_sessionId_idx" ON "SlideEvent"("sessionId");

-- CreateIndex
CREATE INDEX "SlideEvent_fileId_idx" ON "SlideEvent"("fileId");
