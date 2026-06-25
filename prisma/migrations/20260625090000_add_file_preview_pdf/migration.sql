-- Add server-generated PDF preview metadata for PPT/PPTX display.
ALTER TABLE "FileAsset" ADD COLUMN "previewPdfPath" TEXT;
ALTER TABLE "FileAsset" ADD COLUMN "previewStatus" TEXT NOT NULL DEFAULT 'NONE';
ALTER TABLE "FileAsset" ADD COLUMN "previewError" TEXT;
