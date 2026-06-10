-- CreateTable
CREATE TABLE "TrainingAnalysis" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "sessionId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "transcriptId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "analysisType" TEXT NOT NULL DEFAULT 'PITCH',
    "durationSec" INTEGER NOT NULL,
    "pageCount" INTEGER,
    "slideEventCount" INTEGER,
    "overallScore" INTEGER,
    "summary" TEXT NOT NULL,
    "strengthsJson" TEXT NOT NULL,
    "weaknessesJson" TEXT NOT NULL,
    "suggestionsJson" TEXT NOT NULL,
    "coverageJson" TEXT NOT NULL,
    "timingJson" TEXT NOT NULL,
    "slideSyncJson" TEXT NOT NULL,
    "riskQuestionsJson" TEXT NOT NULL,
    "rawResultJson" TEXT NOT NULL,
    "errorMessage" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "TrainingAnalysis_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "TrainingSession" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "TrainingAnalysis_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "TrainingAnalysis_transcriptId_fkey" FOREIGN KEY ("transcriptId") REFERENCES "TrainingTranscript" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "TrainingAnalysis_sessionId_idx" ON "TrainingAnalysis"("sessionId");

-- CreateIndex
CREATE INDEX "TrainingAnalysis_projectId_idx" ON "TrainingAnalysis"("projectId");

-- CreateIndex
CREATE INDEX "TrainingAnalysis_transcriptId_idx" ON "TrainingAnalysis"("transcriptId");

-- CreateIndex
CREATE INDEX "TrainingAnalysis_status_idx" ON "TrainingAnalysis"("status");

-- CreateIndex
CREATE INDEX "TrainingAnalysis_analysisType_idx" ON "TrainingAnalysis"("analysisType");
