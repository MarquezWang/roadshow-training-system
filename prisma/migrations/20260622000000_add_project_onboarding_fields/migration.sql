-- Add project onboarding fields used by the AI-assisted project setup flow.
ALTER TABLE "Project" ADD COLUMN "productForm" TEXT NOT NULL DEFAULT '';
ALTER TABLE "Project" ADD COLUMN "trlLevel" INTEGER;
ALTER TABLE "Project" ADD COLUMN "trlReason" TEXT NOT NULL DEFAULT '';
ALTER TABLE "Project" ADD COLUMN "teamInfo" TEXT NOT NULL DEFAULT '';
ALTER TABLE "Project" ADD COLUMN "currentProgress" TEXT NOT NULL DEFAULT '';
