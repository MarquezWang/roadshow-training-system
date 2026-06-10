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
          initialStatus={session.status}
          initialPageIndex={session.currentPageIndex}
          initialPitchStartedAt={session.pitchStartedAt?.toISOString() ?? null}
          initialElapsedSec={initialElapsedSec}
          initialRemainingSec={initialRemainingSec}
          initialPitchDurationSec={session.pitchDurationSec}
          files={session.project.fileAssets}
        />
      </div>
    </main>
  );
}
