-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_ScoreResult" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "projectId" TEXT NOT NULL,
    "ruleId" TEXT,
    "totalScore" INTEGER NOT NULL,
    "scoreDetail" TEXT NOT NULL,
    "comments" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "ScoreResult_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ScoreResult_ruleId_fkey" FOREIGN KEY ("ruleId") REFERENCES "EvaluationRule" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_ScoreResult" ("comments", "createdAt", "id", "projectId", "scoreDetail", "totalScore", "updatedAt") SELECT "comments", "createdAt", "id", "projectId", "scoreDetail", "totalScore", "updatedAt" FROM "ScoreResult";
DROP TABLE "ScoreResult";
ALTER TABLE "new_ScoreResult" RENAME TO "ScoreResult";
CREATE INDEX "ScoreResult_projectId_idx" ON "ScoreResult"("projectId");
CREATE INDEX "ScoreResult_ruleId_idx" ON "ScoreResult"("ruleId");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateTable
CREATE TABLE "HistoricalQuestion" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "contestName" TEXT,
    "projectField" TEXT,
    "perspective" TEXT NOT NULL,
    "questionText" TEXT NOT NULL,
    "focus" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateIndex
CREATE INDEX "HistoricalQuestion_perspective_idx" ON "HistoricalQuestion"("perspective");

-- CreateIndex
CREATE INDEX "HistoricalQuestion_projectField_idx" ON "HistoricalQuestion"("projectField");
