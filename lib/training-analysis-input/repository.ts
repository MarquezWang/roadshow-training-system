import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";

export const trainingAnalysisInputSessionSelect = {
  id: true,
  status: true,
  pitchStartedAt: true,
  pitchEndedAt: true,
  pitchDurationSec: true,
  qaStartedAt: true,
  qaEndedAt: true,
  qaDurationSec: true,
  currentPageIndex: true,
  primaryFileId: true,
  projectContextSnapshot: true,
  project: {
    select: {
      id: true,
      name: true,
      field: true,
      stage: true,
      summary: true,
      coreTechnology: true,
      applicationScenario: true,
      businessModel: true,
      cooperationDemand: true,
      productForm: true,
      trlBasis: true,
      teamInfo: true,
      cooperationDemandDetail: true,
      needsConversionSupport: true,
      updatedAt: true,
      fileAssets: {
        where: { includeInAIContext: true },
        orderBy: { id: "asc" },
        select: {
          id: true,
          originalName: true,
          fileType: true,
          parseStatus: true,
          includeInAIContext: true,
          extractedText: true,
          updatedAt: true,
        },
      },
    },
  },
  slideEvents: {
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    select: {
      id: true,
      fileId: true,
      pageIndex: true,
      eventType: true,
      elapsedSec: true,
      createdAt: true,
    },
  },
  recordings: {
    orderBy: { id: "asc" },
    select: {
      id: true,
      phase: true,
      durationSec: true,
      startedAt: true,
      endedAt: true,
      updatedAt: true,
      transcript: {
        select: {
          id: true,
          status: true,
          source: true,
          language: true,
          text: true,
          revision: true,
          completedAt: true,
          updatedAt: true,
        },
      },
    },
  },
  trainingQuestions: {
    orderBy: [{ orderIndex: "asc" }, { id: "asc" }],
    select: {
      id: true,
      orderIndex: true,
      questionText: true,
      questionType: true,
      source: true,
      basis: true,
      updatedAt: true,
      answer: {
        select: {
          id: true,
          recordingId: true,
          answerText: true,
          revealedQuestionText: true,
          startedAt: true,
          endedAt: true,
          durationSec: true,
          updatedAt: true,
        },
      },
    },
  },
} satisfies Prisma.TrainingSessionSelect;

export type TrainingAnalysisInputSession = Prisma.TrainingSessionGetPayload<{
  select: typeof trainingAnalysisInputSessionSelect;
}>;

export function findTrainingAnalysisInputSession(sessionId: string) {
  return prisma.trainingSession.findUnique({
    where: { id: sessionId },
    select: trainingAnalysisInputSessionSelect,
  });
}
