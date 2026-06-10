import Link from "next/link";
import { notFound } from "next/navigation";
import { PageHeader } from "@/components/page-header";
import { prisma } from "@/lib/prisma";
import { TrainingSessionClient } from "./training-session-client";

const pitchLimitSec = 9 * 60;

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
    include: {
      project: {
        select: {
          id: true,
          name: true,
          fileAssets: {
            where: {
              parseStatus: "SUCCESS",
              includeInAIContext: true,
              extractedText: {
                not: null,
              },
            },
            orderBy: {
              createdAt: "asc",
            },
            select: {
              id: true,
              originalName: true,
              fileType: true,
            },
          },
        },
      },
      recordings: {
        where: {
          phase: "PITCH",
          status: "RECORDED",
        },
        orderBy: {
          createdAt: "desc",
        },
        take: 1,
        select: {
          id: true,
          phase: true,
          status: true,
          fileName: true,
          mimeType: true,
          sizeBytes: true,
          durationSec: true,
          startedAt: true,
          endedAt: true,
          transcript: {
            select: {
              id: true,
              recordingId: true,
              sessionId: true,
              status: true,
              source: true,
              language: true,
              text: true,
              segmentsJson: true,
              errorMessage: true,
              startedAt: true,
              completedAt: true,
              createdAt: true,
              updatedAt: true,
            },
          },
        },
      },
    },
  });

  if (!session) {
    notFound();
  }

  const [serverClock] = await prisma.$queryRaw<Array<{ nowSec: number }>>`
    SELECT CAST(strftime('%s', 'now') AS INTEGER) AS nowSec
  `;
  const serverNowSec = Number(serverClock?.nowSec ?? 0);
  const initialElapsedSec =
    session.pitchDurationSec ??
    (session.status === "PITCHING" && session.pitchStartedAt
      ? Math.max(
          0,
          serverNowSec - Math.floor(session.pitchStartedAt.getTime() / 1000),
        )
      : 0);
  const initialRemainingSec = Math.max(0, pitchLimitSec - initialElapsedSec);
  const previewFile =
    session.project.fileAssets.find(
      (file) => file.fileType.toLowerCase() === "pdf",
    ) ?? null;
  const initialRecording = session.recordings[0]
    ? {
        ...session.recordings[0],
        startedAt: session.recordings[0].startedAt?.toISOString() ?? null,
        endedAt: session.recordings[0].endedAt?.toISOString() ?? null,
        playbackUrl: `/training/${session.id}/recordings/${session.recordings[0].id}`,
        transcript: session.recordings[0].transcript
          ? {
              ...session.recordings[0].transcript,
              startedAt:
                session.recordings[0].transcript.startedAt?.toISOString() ??
                null,
              completedAt:
                session.recordings[0].transcript.completedAt?.toISOString() ??
                null,
              createdAt: session.recordings[0].transcript.createdAt.toISOString(),
              updatedAt: session.recordings[0].transcript.updatedAt.toISOString(),
            }
          : null,
      }
    : null;

  return (
    <main className="mx-auto w-full max-w-6xl flex-1 px-6 py-8 sm:px-8 lg:px-10">
      <PageHeader
        title="路演训练"
        description={`当前项目：${session.project.name}`}
      />

      <div className="mt-6 flex flex-col gap-3 sm:flex-row">
        <Link
          href={`/projects/${session.project.id}`}
          className="inline-flex h-10 items-center justify-center rounded-md border border-slate-300 bg-white px-4 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-50"
        >
          返回项目详情
        </Link>
      </div>

      <div className="mt-6">
        <TrainingSessionClient
          sessionId={session.id}
          projectId={session.project.id}
          projectName={session.project.name}
          initialStatus={session.status}
          initialPageIndex={Math.max(0, session.currentPageIndex - 1)}
          initialPitchStartedAt={session.pitchStartedAt?.toISOString() ?? null}
          initialElapsedSec={initialElapsedSec}
          initialRemainingSec={initialRemainingSec}
          initialPitchDurationSec={session.pitchDurationSec}
          files={session.project.fileAssets}
          previewFile={previewFile}
          initialRecording={initialRecording}
        />
      </div>
    </main>
  );
}
