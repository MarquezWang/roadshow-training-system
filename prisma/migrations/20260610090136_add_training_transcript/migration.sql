-- CreateTable
CREATE TABLE "TrainingTranscript" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "recordingId" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "source" TEXT NOT NULL DEFAULT 'MANUAL',
    "language" TEXT NOT NULL DEFAULT 'zh-CN',
    "text" TEXT NOT NULL,
    "segmentsJson" TEXT,
    "errorMessage" TEXT,
    "startedAt" DATETIME,
    "completedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "TrainingTranscript_recordingId_fkey" FOREIGN KEY ("recordingId") REFERENCES "TrainingRecording" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "TrainingTranscript_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "TrainingSession" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "TrainingTranscript_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "TrainingTranscript_recordingId_key" ON "TrainingTranscript"("recordingId");

-- CreateIndex
CREATE INDEX "TrainingTranscript_sessionId_idx" ON "TrainingTranscript"("sessionId");

-- CreateIndex
CREATE INDEX "TrainingTranscript_projectId_idx" ON "TrainingTranscript"("projectId");

-- CreateIndex
CREATE INDEX "TrainingTranscript_status_idx" ON "TrainingTranscript"("status");

-- CreateIndex
CREATE INDEX "TrainingTranscript_source_idx" ON "TrainingTranscript"("source");
