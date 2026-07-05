-- CreateTable
CREATE TABLE "MaterialDiagnosis" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "projectId" TEXT NOT NULL,
    "ruleName" TEXT NOT NULL,
    "totalWeight" INTEGER NOT NULL,
    "readinessLevel" TEXT NOT NULL,
    "readinessScore" INTEGER,
    "summary" TEXT NOT NULL,
    "strengths" TEXT NOT NULL,
    "weaknesses" TEXT NOT NULL,
    "priorityTasks" TEXT NOT NULL,
    "judgeQuestions" TEXT NOT NULL,
    "criteriaResults" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "MaterialDiagnosis_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "MaterialDiagnosis_projectId_idx" ON "MaterialDiagnosis"("projectId");

-- CreateIndex
CREATE INDEX "MaterialDiagnosis_createdAt_idx" ON "MaterialDiagnosis"("createdAt");
