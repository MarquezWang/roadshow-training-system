import { notFound, redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { QaPrepareClient } from "./qa-prepare-client";

type QaPreparePageProps = Readonly<{
  params: Promise<{
    sessionId: string;
  }>;
  searchParams: Promise<{
    recordingId?: string | string[];
  }>;
}>;

export default async function QaPreparePage({
  params,
  searchParams,
}: QaPreparePageProps) {
  const { sessionId } = await params;
  const query = await searchParams;
  const requestedRecordingId = Array.isArray(query.recordingId)
    ? query.recordingId[0]
    : query.recordingId;

  const session = await prisma.trainingSession.findUnique({
    where: {
      id: sessionId,
    },
    select: {
      id: true,
      status: true,
      project: {
        select: {
          name: true,
        },
      },
    },
  });

  if (!session) {
    notFound();
  }

  if (session.status === "ABORTED") {
    redirect(`/training/${session.id}/report`);
  }

  if (session.status === "CREATED" || session.status === "PITCH_READY") {
    redirect(`/training/${session.id}/prepare`);
  }

  if (session.status === "PITCHING") {
    redirect(`/training/${session.id}/pitch`);
  }

  if (session.status === "QAING") {
    redirect(`/training/${session.id}/qa`);
  }

  if (
    session.status === "QA_ENDED" ||
    session.status === "REPORT_READY" ||
    session.status === "FINISHED"
  ) {
    redirect(`/training/${session.id}/report`);
  }

  let recording = requestedRecordingId
    ? await prisma.trainingRecording.findFirst({
        where: {
          id: requestedRecordingId,
          sessionId: session.id,
          phase: "PITCH",
          status: "RECORDED",
        },
        orderBy: {
          createdAt: "desc",
        },
        select: {
          id: true,
        },
      })
    : null;

  if (!recording) {
    recording = await prisma.trainingRecording.findFirst({
      where: {
        sessionId: session.id,
        phase: "PITCH",
        status: "RECORDED",
      },
      orderBy: {
        createdAt: "desc",
      },
      select: {
        id: true,
      },
    });
  }

  return (
    <main className="min-h-screen w-full flex-1 bg-slate-950 text-white">
      <QaPrepareClient
        sessionId={session.id}
        projectName={session.project.name}
        recordingId={recording?.id ?? null}
      />
    </main>
  );
}
