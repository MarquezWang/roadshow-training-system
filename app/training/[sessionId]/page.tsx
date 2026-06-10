import { notFound, redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";

type TrainingSessionPageProps = Readonly<{
  params: Promise<{
    sessionId: string;
  }>;
}>;

function getTrainingFlowPath(sessionId: string, status: string) {
  if (status === "PITCHING") {
    return `/training/${sessionId}/pitch`;
  }

  if (status === "PITCH_ENDED" || status === "QA_READY" || status === "QAING") {
    return `/training/${sessionId}/qa`;
  }

  if (
    status === "QA_ENDED" ||
    status === "REPORT_READY" ||
    status === "FINISHED"
  ) {
    return `/training/${sessionId}/report`;
  }

  return `/training/${sessionId}/prepare`;
}

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
