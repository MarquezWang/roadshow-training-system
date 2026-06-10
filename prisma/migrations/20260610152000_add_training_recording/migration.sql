-- CreateTable
CREATE TABLE "TrainingRecording" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "sessionId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "phase" TEXT NOT NULL DEFAULT 'PITCH',
    "status" TEXT NOT NULL DEFAULT 'RECORDED',
    "originalName" TEXT,
    "fileName" TEXT NOT NULL,
    "filePath" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "durationSec" INTEGER,
    "startedAt" DATETIME,
    "endedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "TrainingRecording_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "TrainingSession" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "TrainingRecording_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "TrainingRecording_sessionId_idx" ON "TrainingRecording"("sessionId");

-- CreateIndex
CREATE INDEX "TrainingRecording_projectId_idx" ON "TrainingRecording"("projectId");

-- CreateIndex
CREATE INDEX "TrainingRecording_phase_idx" ON "TrainingRecording"("phase");

-- CreateIndex
CREATE INDEX "TrainingRecording_status_idx" ON "TrainingRecording"("status");
