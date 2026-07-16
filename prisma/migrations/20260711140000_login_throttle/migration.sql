CREATE TABLE "LoginThrottle" (
  "key" TEXT NOT NULL PRIMARY KEY,
  "failedCount" INTEGER NOT NULL DEFAULT 0,
  "windowStartedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "lockedUntil" DATETIME,
  "updatedAt" DATETIME NOT NULL
);

CREATE INDEX "LoginThrottle_lockedUntil_idx" ON "LoginThrottle"("lockedUntil");
