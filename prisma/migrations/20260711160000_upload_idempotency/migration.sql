ALTER TABLE "FileAsset" ADD COLUMN "uploadKey" TEXT;
ALTER TABLE "TrainingRecording" ADD COLUMN "uploadKey" TEXT;

CREATE UNIQUE INDEX "FileAsset_projectId_uploadKey_key"
ON "FileAsset"("projectId", "uploadKey");

CREATE UNIQUE INDEX "TrainingRecording_sessionId_uploadKey_key"
ON "TrainingRecording"("sessionId", "uploadKey");
