-- Add fields used by the three-step project creation profile.
ALTER TABLE "Project" ADD COLUMN "productForm" TEXT NOT NULL DEFAULT '';
ALTER TABLE "Project" ADD COLUMN "trlBasis" TEXT NOT NULL DEFAULT '';
ALTER TABLE "Project" ADD COLUMN "teamInfo" TEXT NOT NULL DEFAULT '';
ALTER TABLE "Project" ADD COLUMN "cooperationDemandDetail" TEXT NOT NULL DEFAULT '';
