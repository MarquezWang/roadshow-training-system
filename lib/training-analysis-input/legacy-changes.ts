import { prisma } from "@/lib/prisma";

export async function findLegacyInputChangesSince(
  sessionId: string,
  since: Date,
) {
  const session = await prisma.trainingSession.findUnique({
    where: { id: sessionId },
    select: {
      updatedAt: true,
      projectContextSnapshot: true,
      project: {
        select: {
          updatedAt: true,
          fileAssets: {
            where: {
              includeInAIContext: true,
              createdAt: { gt: since },
            },
            select: { id: true },
            take: 1,
          },
        },
      },
      slideEvents: {
        where: { createdAt: { gt: since } },
        select: { id: true },
        take: 1,
      },
      recordings: {
        where: { updatedAt: { gt: since } },
        select: { id: true },
        take: 1,
      },
      transcripts: {
        where: { updatedAt: { gt: since } },
        select: { id: true },
        take: 1,
      },
      trainingQuestions: {
        where: { updatedAt: { gt: since } },
        select: { id: true },
        take: 1,
      },
      trainingAnswers: {
        where: { updatedAt: { gt: since } },
        select: { id: true },
        take: 1,
      },
    },
  });

  if (!session) {
    return ["session_missing"];
  }

  const changes: string[] = [];
  if (session.updatedAt > since) changes.push("session");
  if (
    !session.projectContextSnapshot &&
    session.project.updatedAt > since
  ) {
    changes.push("project");
  }
  if (
    !session.projectContextSnapshot &&
    session.project.fileAssets.length > 0
  ) {
    changes.push("material_added");
  }
  if (session.slideEvents.length > 0) changes.push("slide_event");
  if (session.recordings.length > 0) changes.push("recording");
  if (session.transcripts.length > 0) changes.push("transcript");
  if (session.trainingQuestions.length > 0) changes.push("question");
  if (session.trainingAnswers.length > 0) changes.push("answer");
  return changes;
}
