import { notFound, redirect } from "next/navigation";
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
  const session = await prisma.trainingSession.findUnique({
    where: {
      id: sessionId,
    },
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
