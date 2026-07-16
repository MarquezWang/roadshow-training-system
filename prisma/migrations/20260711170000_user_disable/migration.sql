ALTER TABLE "User" ADD COLUMN "disabledAt" DATETIME;

CREATE INDEX "User_role_disabledAt_idx" ON "User"("role", "disabledAt");
