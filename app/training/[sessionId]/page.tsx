import { notFound, redirect } from "next/navigation";
import { getCurrentAuthUserId, withSessionOwnerFilter } from "@/lib/auth-server";
import { prisma } from "@/lib/prisma";
import { getTrainingFlowPath } from "@/lib/training-status";

type TrainingSessionPageProps = Readonly<{
  params: Promise<{
    sessionId: string;
  }>;
}>;

export default async function TrainingSessionPage({
  params,
}: TrainingSessionPageProps) {
  const { sessionId } = await params;
  const userId = await getCurrentAuthUserId();
  const session = await prisma.trainingSession.findFirst({
    where: withSessionOwnerFilter({ id: sessionId }, userId),
    select: {
      id: true,
      status: true,
    },
  });

  if (!session) {
    notFound();
  }

  redirect(getTrainingFlowPath(session.id, session.status));
}
