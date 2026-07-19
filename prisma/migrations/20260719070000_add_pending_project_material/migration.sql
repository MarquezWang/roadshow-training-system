-- CreateTable
CREATE TABLE "PendingProjectMaterial" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "ownerId" TEXT,
    "originalName" TEXT NOT NULL,
    "fileType" TEXT NOT NULL,
    "filePath" TEXT NOT NULL,
    "fileSize" INTEGER NOT NULL,
    "extractedText" TEXT,
    "parseStatus" TEXT NOT NULL,
    "parseError" TEXT,
    "expiresAt" DATETIME NOT NULL,
    "consumedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "PendingProjectMaterial_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "PendingProjectMaterial_filePath_key" ON "PendingProjectMaterial"("filePath");

-- CreateIndex
CREATE INDEX "PendingProjectMaterial_ownerId_expiresAt_idx" ON "PendingProjectMaterial"("ownerId", "expiresAt");

-- CreateIndex
CREATE INDEX "PendingProjectMaterial_expiresAt_consumedAt_idx" ON "PendingProjectMaterial"("expiresAt", "consumedAt");

-- CreateTable
CREATE TABLE "AiQuotaUsage" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userKey" TEXT NOT NULL,
    "projectKey" TEXT NOT NULL,
    "task" TEXT NOT NULL,
    "dayKey" TEXT NOT NULL,
    "requestCount" INTEGER NOT NULL DEFAULT 0,
    "tokenCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateIndex
CREATE UNIQUE INDEX "AiQuotaUsage_userKey_projectKey_task_dayKey_key" ON "AiQuotaUsage"("userKey", "projectKey", "task", "dayKey");

-- CreateIndex
CREATE INDEX "AiQuotaUsage_userKey_dayKey_idx" ON "AiQuotaUsage"("userKey", "dayKey");
