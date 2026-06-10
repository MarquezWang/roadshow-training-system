-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_TrainingAnswer" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "sessionId" TEXT NOT NULL,
    "questionId" TEXT NOT NULL,
    "recordingId" TEXT,
    "answerText" TEXT,
    "revealedQuestionText" BOOLEAN NOT NULL DEFAULT false,
    "startedAt" DATETIME,
    "endedAt" DATETIME,
    "durationSec" INTEGER,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "TrainingAnswer_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "TrainingSession" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "TrainingAnswer_questionId_fkey" FOREIGN KEY ("questionId") REFERENCES "TrainingQuestion" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "TrainingAnswer_recordingId_fkey" FOREIGN KEY ("recordingId") REFERENCES "TrainingRecording" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_TrainingAnswer" ("answerText", "createdAt", "durationSec", "endedAt", "id", "questionId", "revealedQuestionText", "sessionId", "startedAt", "updatedAt") SELECT "answerText", "createdAt", "durationSec", "endedAt", "id", "questionId", "revealedQuestionText", "sessionId", "startedAt", "updatedAt" FROM "TrainingAnswer";
DROP TABLE "TrainingAnswer";
ALTER TABLE "new_TrainingAnswer" RENAME TO "TrainingAnswer";
CREATE UNIQUE INDEX "TrainingAnswer_questionId_key" ON "TrainingAnswer"("questionId");
CREATE UNIQUE INDEX "TrainingAnswer_recordingId_key" ON "TrainingAnswer"("recordingId");
CREATE INDEX "TrainingAnswer_sessionId_idx" ON "TrainingAnswer"("sessionId");
CREATE INDEX "TrainingAnswer_recordingId_idx" ON "TrainingAnswer"("recordingId");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
