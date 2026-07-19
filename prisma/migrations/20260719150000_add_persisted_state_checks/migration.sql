-- SQLite cannot add CHECK constraints to an existing table. Rebuild the
-- persisted workflow tables so invalid roles and state-machine values are
-- rejected even when a write bypasses application validation.
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;

CREATE TABLE "new_User" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT,
    "sessionVersion" INTEGER NOT NULL DEFAULT 0,
    "disabledAt" DATETIME,
    "role" TEXT NOT NULL DEFAULT 'TEAM' CHECK ("role" IN ('USER', 'TEAM', 'ADMIN')),
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);
INSERT INTO "new_User" (
    "id", "name", "email", "passwordHash", "sessionVersion", "disabledAt",
    "role", "createdAt", "updatedAt"
)
SELECT
    "id", "name", "email", "passwordHash", "sessionVersion", "disabledAt",
    "role", "createdAt", "updatedAt"
FROM "User";
DROP TABLE "User";
ALTER TABLE "new_User" RENAME TO "User";
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");
CREATE INDEX "User_role_disabledAt_idx" ON "User"("role", "disabledAt");

CREATE TABLE "new_PendingProjectMaterial" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "ownerId" TEXT,
    "originalName" TEXT NOT NULL,
    "fileType" TEXT NOT NULL,
    "filePath" TEXT NOT NULL,
    "fileSize" INTEGER NOT NULL,
    "extractedText" TEXT,
    "parseStatus" TEXT NOT NULL CHECK ("parseStatus" IN ('PENDING', 'PROCESSING', 'SUCCESS', 'FAILED')),
    "parseError" TEXT,
    "expiresAt" DATETIME NOT NULL,
    "consumedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "PendingProjectMaterial_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_PendingProjectMaterial" (
    "id", "ownerId", "originalName", "fileType", "filePath", "fileSize",
    "extractedText", "parseStatus", "parseError", "expiresAt", "consumedAt",
    "createdAt", "updatedAt"
)
SELECT
    "id", "ownerId", "originalName", "fileType", "filePath", "fileSize",
    "extractedText", "parseStatus", "parseError", "expiresAt", "consumedAt",
    "createdAt", "updatedAt"
FROM "PendingProjectMaterial";
DROP TABLE "PendingProjectMaterial";
ALTER TABLE "new_PendingProjectMaterial" RENAME TO "PendingProjectMaterial";
CREATE UNIQUE INDEX "PendingProjectMaterial_filePath_key" ON "PendingProjectMaterial"("filePath");
CREATE INDEX "PendingProjectMaterial_ownerId_expiresAt_idx" ON "PendingProjectMaterial"("ownerId", "expiresAt");
CREATE INDEX "PendingProjectMaterial_expiresAt_consumedAt_idx" ON "PendingProjectMaterial"("expiresAt", "consumedAt");

CREATE TABLE "new_AsyncJob" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "jobKey" TEXT NOT NULL,
    "jobType" TEXT NOT NULL,
    "resourceId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'RUNNING' CHECK ("status" IN ('PENDING', 'RUNNING', 'RETRY_WAIT', 'COMPLETED', 'FAILED')),
    "ownerToken" TEXT NOT NULL,
    "leaseExpiresAt" DATETIME,
    "attempt" INTEGER NOT NULL DEFAULT 1,
    "maxAttempts" INTEGER NOT NULL DEFAULT 1,
    "nextAttemptAt" DATETIME,
    "errorMessage" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);
INSERT INTO "new_AsyncJob" (
    "id", "jobKey", "jobType", "resourceId", "status", "ownerToken",
    "leaseExpiresAt", "attempt", "maxAttempts", "nextAttemptAt",
    "errorMessage", "createdAt", "updatedAt"
)
SELECT
    "id", "jobKey", "jobType", "resourceId", "status", "ownerToken",
    "leaseExpiresAt", "attempt", "maxAttempts", "nextAttemptAt",
    "errorMessage", "createdAt", "updatedAt"
FROM "AsyncJob";
DROP TABLE "AsyncJob";
ALTER TABLE "new_AsyncJob" RENAME TO "AsyncJob";
CREATE UNIQUE INDEX "AsyncJob_jobKey_key" ON "AsyncJob"("jobKey");
CREATE INDEX "AsyncJob_jobType_resourceId_idx" ON "AsyncJob"("jobType", "resourceId");
CREATE INDEX "AsyncJob_status_leaseExpiresAt_idx" ON "AsyncJob"("status", "leaseExpiresAt");
CREATE INDEX "AsyncJob_jobType_status_nextAttemptAt_idx" ON "AsyncJob"("jobType", "status", "nextAttemptAt");

CREATE TABLE "new_FileAsset" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "projectId" TEXT NOT NULL,
    "originalName" TEXT NOT NULL,
    "fileType" TEXT NOT NULL,
    "filePath" TEXT NOT NULL,
    "fileSize" INTEGER NOT NULL,
    "extractedText" TEXT,
    "parseStatus" TEXT NOT NULL DEFAULT 'PENDING' CHECK ("parseStatus" IN ('PENDING', 'PROCESSING', 'SUCCESS', 'FAILED')),
    "parseError" TEXT,
    "previewPdfPath" TEXT,
    "previewStatus" TEXT NOT NULL DEFAULT 'NONE' CHECK ("previewStatus" IN ('NONE', 'PENDING', 'FINALIZING', 'READY', 'FAILED')),
    "previewError" TEXT,
    "previewAttemptId" TEXT,
    "previewStartedAt" DATETIME,
    "includeInAIContext" BOOLEAN NOT NULL DEFAULT true,
    "uploadKey" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "FileAsset_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_FileAsset" (
    "id", "projectId", "originalName", "fileType", "filePath", "fileSize",
    "extractedText", "parseStatus", "parseError", "previewPdfPath",
    "previewStatus", "previewError", "previewAttemptId", "previewStartedAt",
    "includeInAIContext", "uploadKey", "createdAt", "updatedAt"
)
SELECT
    "id", "projectId", "originalName", "fileType", "filePath", "fileSize",
    "extractedText", "parseStatus", "parseError", "previewPdfPath",
    "previewStatus", "previewError", "previewAttemptId", "previewStartedAt",
    "includeInAIContext", "uploadKey", "createdAt", "updatedAt"
FROM "FileAsset";
DROP TABLE "FileAsset";
ALTER TABLE "new_FileAsset" RENAME TO "FileAsset";
CREATE UNIQUE INDEX "FileAsset_projectId_uploadKey_key" ON "FileAsset"("projectId", "uploadKey");
CREATE INDEX "FileAsset_projectId_idx" ON "FileAsset"("projectId");

CREATE TABLE "new_TrainingSession" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "projectId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'CREATED' CHECK ("status" IN ('CREATED', 'PITCH_READY', 'PITCHING', 'PITCH_ENDED', 'QA_READY', 'QAING', 'QA_ENDED', 'REPORT_READY', 'FINISHED', 'ABORTED')),
    "pitchStartedAt" DATETIME,
    "pitchEndedAt" DATETIME,
    "pitchDurationSec" INTEGER,
    "qaStartedAt" DATETIME,
    "qaEndedAt" DATETIME,
    "qaDurationSec" INTEGER,
    "currentPageIndex" INTEGER NOT NULL DEFAULT 0,
    "primaryFileId" TEXT,
    "projectContextSnapshot" TEXT,
    "contextSchemaVersion" TEXT NOT NULL DEFAULT 'project-ai-context:legacy-v0',
    "currentAnalysisId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "TrainingSession_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "TrainingSession_currentAnalysisId_fkey" FOREIGN KEY ("currentAnalysisId") REFERENCES "TrainingAnalysis" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_TrainingSession" (
    "id", "projectId", "status", "pitchStartedAt", "pitchEndedAt",
    "pitchDurationSec", "qaStartedAt", "qaEndedAt", "qaDurationSec",
    "currentPageIndex", "primaryFileId", "projectContextSnapshot",
    "contextSchemaVersion", "currentAnalysisId", "createdAt", "updatedAt"
)
SELECT
    "id", "projectId", "status", "pitchStartedAt", "pitchEndedAt",
    "pitchDurationSec", "qaStartedAt", "qaEndedAt", "qaDurationSec",
    "currentPageIndex", "primaryFileId", "projectContextSnapshot",
    "contextSchemaVersion", "currentAnalysisId", "createdAt", "updatedAt"
FROM "TrainingSession";
DROP TABLE "TrainingSession";
ALTER TABLE "new_TrainingSession" RENAME TO "TrainingSession";
CREATE UNIQUE INDEX "TrainingSession_currentAnalysisId_key" ON "TrainingSession"("currentAnalysisId");
CREATE INDEX "TrainingSession_projectId_idx" ON "TrainingSession"("projectId");
CREATE INDEX "TrainingSession_status_idx" ON "TrainingSession"("status");

CREATE TABLE "new_SlideEvent" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "sessionId" TEXT NOT NULL,
    "fileId" TEXT,
    "pageIndex" INTEGER NOT NULL,
    "eventType" TEXT NOT NULL CHECK ("eventType" IN ('START', 'END', 'NEXT', 'PREV', 'JUMP', 'PAGE_CHANGE')),
    "elapsedSec" INTEGER NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "SlideEvent_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "TrainingSession" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "SlideEvent_fileId_fkey" FOREIGN KEY ("fileId") REFERENCES "FileAsset" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_SlideEvent" (
    "id", "sessionId", "fileId", "pageIndex", "eventType", "elapsedSec",
    "createdAt"
)
SELECT
    "id", "sessionId", "fileId", "pageIndex", "eventType", "elapsedSec",
    "createdAt"
FROM "SlideEvent";
DROP TABLE "SlideEvent";
ALTER TABLE "new_SlideEvent" RENAME TO "SlideEvent";
CREATE INDEX "SlideEvent_sessionId_idx" ON "SlideEvent"("sessionId");
CREATE INDEX "SlideEvent_fileId_idx" ON "SlideEvent"("fileId");

CREATE TABLE "new_TrainingRecording" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "sessionId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "phase" TEXT NOT NULL DEFAULT 'PITCH' CHECK ("phase" IN ('PITCH', 'QA')),
    "status" TEXT NOT NULL DEFAULT 'RECORDED' CHECK ("status" IN ('RECORDED', 'MISSING')),
    "originalName" TEXT,
    "fileName" TEXT NOT NULL,
    "filePath" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "durationSec" INTEGER,
    "startedAt" DATETIME,
    "endedAt" DATETIME,
    "uploadKey" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "TrainingRecording_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "TrainingSession" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "TrainingRecording_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_TrainingRecording" (
    "id", "sessionId", "projectId", "phase", "status", "originalName",
    "fileName", "filePath", "mimeType", "sizeBytes", "durationSec",
    "startedAt", "endedAt", "uploadKey", "createdAt", "updatedAt"
)
SELECT
    "id", "sessionId", "projectId", "phase", "status", "originalName",
    "fileName", "filePath", "mimeType", "sizeBytes", "durationSec",
    "startedAt", "endedAt", "uploadKey", "createdAt", "updatedAt"
FROM "TrainingRecording";
DROP TABLE "TrainingRecording";
ALTER TABLE "new_TrainingRecording" RENAME TO "TrainingRecording";
CREATE UNIQUE INDEX "TrainingRecording_sessionId_uploadKey_key" ON "TrainingRecording"("sessionId", "uploadKey");
CREATE INDEX "TrainingRecording_sessionId_idx" ON "TrainingRecording"("sessionId");
CREATE INDEX "TrainingRecording_projectId_idx" ON "TrainingRecording"("projectId");
CREATE INDEX "TrainingRecording_phase_idx" ON "TrainingRecording"("phase");
CREATE INDEX "TrainingRecording_status_idx" ON "TrainingRecording"("status");

CREATE TABLE "new_TrainingTranscript" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "recordingId" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING' CHECK ("status" IN ('PENDING', 'PROCESSING', 'COMPLETED', 'FAILED')),
    "source" TEXT NOT NULL DEFAULT 'MANUAL' CHECK ("source" IN ('MANUAL', 'ASR_PROVIDER', 'ASR', 'OPENAI', 'XFYUN', 'TENCENT', 'TENCENT_FLASH')),
    "language" TEXT NOT NULL DEFAULT 'zh-CN',
    "text" TEXT NOT NULL,
    "segmentsJson" TEXT,
    "segmentsSchemaVersion" TEXT NOT NULL DEFAULT 'training-transcript-segments:legacy-v0',
    "errorMessage" TEXT,
    "startedAt" DATETIME,
    "completedAt" DATETIME,
    "revision" INTEGER NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "TrainingTranscript_recordingId_fkey" FOREIGN KEY ("recordingId") REFERENCES "TrainingRecording" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "TrainingTranscript_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "TrainingSession" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "TrainingTranscript_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_TrainingTranscript" (
    "id", "recordingId", "sessionId", "projectId", "status", "source",
    "language", "text", "segmentsJson", "segmentsSchemaVersion",
    "errorMessage", "startedAt", "completedAt", "revision", "createdAt",
    "updatedAt"
)
SELECT
    "id", "recordingId", "sessionId", "projectId", "status", "source",
    "language", "text", "segmentsJson", "segmentsSchemaVersion",
    "errorMessage", "startedAt", "completedAt", "revision", "createdAt",
    "updatedAt"
FROM "TrainingTranscript";
DROP TABLE "TrainingTranscript";
ALTER TABLE "new_TrainingTranscript" RENAME TO "TrainingTranscript";
CREATE UNIQUE INDEX "TrainingTranscript_recordingId_key" ON "TrainingTranscript"("recordingId");
CREATE INDEX "TrainingTranscript_sessionId_idx" ON "TrainingTranscript"("sessionId");
CREATE INDEX "TrainingTranscript_projectId_idx" ON "TrainingTranscript"("projectId");
CREATE INDEX "TrainingTranscript_status_idx" ON "TrainingTranscript"("status");
CREATE INDEX "TrainingTranscript_source_idx" ON "TrainingTranscript"("source");

CREATE TABLE "new_TrainingAnalysis" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "sessionId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "transcriptId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'PENDING' CHECK ("status" IN ('PENDING', 'PROCESSING', 'COMPLETED', 'FAILED')),
    "analysisType" TEXT NOT NULL DEFAULT 'PITCH' CHECK ("analysisType" IN ('PITCH')),
    "durationSec" INTEGER NOT NULL,
    "pageCount" INTEGER,
    "slideEventCount" INTEGER,
    "overallScore" INTEGER,
    "summary" TEXT NOT NULL,
    "strengthsJson" TEXT NOT NULL,
    "weaknessesJson" TEXT NOT NULL,
    "suggestionsJson" TEXT NOT NULL,
    "coverageJson" TEXT NOT NULL,
    "timingJson" TEXT NOT NULL,
    "slideSyncJson" TEXT NOT NULL,
    "riskQuestionsJson" TEXT NOT NULL,
    "rawResultJson" TEXT NOT NULL,
    "errorMessage" TEXT,
    "isFallback" BOOLEAN NOT NULL DEFAULT false,
    "fallbackReason" TEXT,
    "inputHash" TEXT NOT NULL DEFAULT '',
    "promptVersion" TEXT NOT NULL DEFAULT '',
    "schemaVersion" TEXT NOT NULL DEFAULT '',
    "modelVersion" TEXT NOT NULL DEFAULT '',
    "ruleVersion" TEXT NOT NULL DEFAULT '',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "TrainingAnalysis_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "TrainingSession" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "TrainingAnalysis_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "TrainingAnalysis_transcriptId_fkey" FOREIGN KEY ("transcriptId") REFERENCES "TrainingTranscript" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_TrainingAnalysis" (
    "id", "sessionId", "projectId", "transcriptId", "status",
    "analysisType", "durationSec", "pageCount", "slideEventCount",
    "overallScore", "summary", "strengthsJson", "weaknessesJson",
    "suggestionsJson", "coverageJson", "timingJson", "slideSyncJson",
    "riskQuestionsJson", "rawResultJson", "errorMessage", "isFallback",
    "fallbackReason", "inputHash", "promptVersion", "schemaVersion",
    "modelVersion", "ruleVersion", "createdAt", "updatedAt"
)
SELECT
    "id", "sessionId", "projectId", "transcriptId", "status",
    "analysisType", "durationSec", "pageCount", "slideEventCount",
    "overallScore", "summary", "strengthsJson", "weaknessesJson",
    "suggestionsJson", "coverageJson", "timingJson", "slideSyncJson",
    "riskQuestionsJson", "rawResultJson", "errorMessage", "isFallback",
    "fallbackReason", "inputHash", "promptVersion", "schemaVersion",
    "modelVersion", "ruleVersion", "createdAt", "updatedAt"
FROM "TrainingAnalysis";
DROP TABLE "TrainingAnalysis";
ALTER TABLE "new_TrainingAnalysis" RENAME TO "TrainingAnalysis";
CREATE INDEX "TrainingAnalysis_sessionId_idx" ON "TrainingAnalysis"("sessionId");
CREATE INDEX "TrainingAnalysis_projectId_idx" ON "TrainingAnalysis"("projectId");
CREATE INDEX "TrainingAnalysis_transcriptId_idx" ON "TrainingAnalysis"("transcriptId");
CREATE INDEX "TrainingAnalysis_status_idx" ON "TrainingAnalysis"("status");
CREATE INDEX "TrainingAnalysis_analysisType_idx" ON "TrainingAnalysis"("analysisType");

CREATE TABLE "new_TrainingQuestion" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "sessionId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "orderIndex" INTEGER NOT NULL,
    "questionText" TEXT NOT NULL,
    "questionType" TEXT,
    "source" TEXT NOT NULL DEFAULT 'AI' CHECK ("source" IN ('AI', 'DYNAMIC_FOLLOWUP', 'GENERATED', 'BASE')),
    "basis" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "TrainingQuestion_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "TrainingSession" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "TrainingQuestion_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_TrainingQuestion" (
    "id", "sessionId", "projectId", "orderIndex", "questionText",
    "questionType", "source", "basis", "createdAt", "updatedAt"
)
SELECT
    "id", "sessionId", "projectId", "orderIndex", "questionText",
    "questionType", "source", "basis", "createdAt", "updatedAt"
FROM "TrainingQuestion";
DROP TABLE "TrainingQuestion";
ALTER TABLE "new_TrainingQuestion" RENAME TO "TrainingQuestion";
CREATE UNIQUE INDEX "TrainingQuestion_sessionId_orderIndex_key" ON "TrainingQuestion"("sessionId", "orderIndex");
CREATE INDEX "TrainingQuestion_sessionId_idx" ON "TrainingQuestion"("sessionId");
CREATE INDEX "TrainingQuestion_projectId_idx" ON "TrainingQuestion"("projectId");
CREATE INDEX "TrainingQuestion_source_idx" ON "TrainingQuestion"("source");

CREATE TABLE "new_KnowledgeSource" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "title" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "filePath" TEXT,
    "rawText" TEXT,
    "status" TEXT NOT NULL DEFAULT 'PENDING' CHECK ("status" IN ('PENDING', 'PROCESSING', 'PROCESSED', 'FAILED')),
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);
INSERT INTO "new_KnowledgeSource" (
    "id", "title", "type", "filePath", "rawText", "status", "createdAt",
    "updatedAt"
)
SELECT
    "id", "title", "type", "filePath", "rawText", "status", "createdAt",
    "updatedAt"
FROM "KnowledgeSource";
DROP TABLE "KnowledgeSource";
ALTER TABLE "new_KnowledgeSource" RENAME TO "KnowledgeSource";
CREATE INDEX "KnowledgeSource_type_idx" ON "KnowledgeSource"("type");
CREATE INDEX "KnowledgeSource_status_idx" ON "KnowledgeSource"("status");

PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
