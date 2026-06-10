-- CreateTable
CREATE TABLE "TrainingQuestion" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "sessionId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "orderIndex" INTEGER NOT NULL,
    "questionText" TEXT NOT NULL,
    "questionType" TEXT,
    "source" TEXT NOT NULL DEFAULT 'AI',
    "basis" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "TrainingQuestion_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "TrainingSession" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "TrainingQuestion_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "TrainingAnswer" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "sessionId" TEXT NOT NULL,
    "questionId" TEXT NOT NULL,
    "answerText" TEXT,
    "startedAt" DATETIME,
    "endedAt" DATETIME,
    "durationSec" INTEGER,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "TrainingAnswer_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "TrainingSession" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "TrainingAnswer_questionId_fkey" FOREIGN KEY ("questionId") REFERENCES "TrainingQuestion" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "TrainingQuestion_sessionId_idx" ON "TrainingQuestion"("sessionId");

-- CreateIndex
CREATE INDEX "TrainingQuestion_projectId_idx" ON "TrainingQuestion"("projectId");

-- CreateIndex
CREATE INDEX "TrainingQuestion_source_idx" ON "TrainingQuestion"("source");

-- CreateIndex
CREATE UNIQUE INDEX "TrainingQuestion_sessionId_orderIndex_key" ON "TrainingQuestion"("sessionId", "orderIndex");

-- CreateIndex
CREATE UNIQUE INDEX "TrainingAnswer_questionId_key" ON "TrainingAnswer"("questionId");

-- CreateIndex
CREATE INDEX "TrainingAnswer_sessionId_idx" ON "TrainingAnswer"("sessionId");
