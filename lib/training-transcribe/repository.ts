import path from "path";

import { prisma } from "@/lib/prisma";
import { TRAINING_TRANSCRIPTION_JOB_TYPE } from "@/lib/training-transcription-job.mjs";

import { TranscribeHttpError } from "./errors";
import { transcriptSelect, type TranscriptionTarget } from "./types";

const RECOVERY_SCAN_LIMIT = 25;

export async function findTranscriptionTarget(
  sessionId: string,
  recordingId: string,
): Promise<TranscriptionTarget> {
  const recording = await prisma.trainingRecording.findFirst({
    where: {
      id: recordingId,
      sessionId,
    },
    select: {
      id: true,
      sessionId: true,
      projectId: true,
      phase: true,
      filePath: true,
      mimeType: true,
      transcript: {
        select: transcriptSelect,
      },
    },
  });

  if (!recording) {
    throw new TranscribeHttpError("录音不存在。", 404);
  }

  if (recording.phase !== "PITCH" && recording.phase !== "QA") {
    throw new TranscribeHttpError("仅支持转写 PITCH 或 QA 阶段录音。", 400);
  }

  if (!recording.filePath) {
    throw new TranscribeHttpError("录音文件路径为空。", 400);
  }

  return {
    ...recording,
    absolutePath: path.resolve(
      /* turbopackIgnore: true */ process.cwd(),
      recording.filePath,
    ),
  };
}

export function readTranscript(recordingId: string) {
  return prisma.trainingTranscript.findUnique({
    where: { recordingId },
    select: transcriptSelect,
  });
}

export function findSessionRecoveryRecordings(sessionId: string) {
  return prisma.trainingRecording.findMany({
    where: {
      sessionId,
      phase: { in: ["PITCH", "QA"] },
      OR: [
        { transcript: { is: null } },
        {
          transcript: {
            is: { status: { in: ["PENDING", "PROCESSING"] } },
          },
        },
      ],
    },
    select: { id: true },
    take: RECOVERY_SCAN_LIMIT,
  });
}

export async function findDueTrainingTranscriptionRecordings(now: Date) {
  const dueJobs = await prisma.asyncJob.findMany({
    where: {
      jobType: TRAINING_TRANSCRIPTION_JOB_TYPE,
      OR: [
        { status: "PENDING" },
        {
          status: "RETRY_WAIT",
          OR: [{ nextAttemptAt: null }, { nextAttemptAt: { lte: now } }],
        },
        {
          status: "RUNNING",
          OR: [{ leaseExpiresAt: null }, { leaseExpiresAt: { lte: now } }],
        },
      ],
    },
    orderBy: { updatedAt: "asc" },
    take: RECOVERY_SCAN_LIMIT,
    select: { resourceId: true },
  });
  const dueRecordingIds = dueJobs.map((job) => job.resourceId);
  const dueRecordings = await prisma.trainingRecording.findMany({
    where: {
      id: { in: dueRecordingIds },
      phase: { in: ["PITCH", "QA"] },
    },
    select: { id: true, sessionId: true },
  });
  const foundRecordingIds = new Set(
    dueRecordings.map((recording) => recording.id),
  );
  const missingResourceIds = dueRecordingIds.filter(
    (recordingId) => !foundRecordingIds.has(recordingId),
  );

  if (missingResourceIds.length > 0) {
    await prisma.asyncJob.updateMany({
      where: {
        jobType: TRAINING_TRANSCRIPTION_JOB_TYPE,
        resourceId: { in: missingResourceIds },
        status: { in: ["PENDING", "RETRY_WAIT", "RUNNING"] },
      },
      data: {
        status: "FAILED",
        leaseExpiresAt: null,
        nextAttemptAt: null,
        errorMessage: "录音记录已不存在。",
      },
    });
  }

  return dueRecordings;
}
