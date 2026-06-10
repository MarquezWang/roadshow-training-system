import Link from "next/link";
import { notFound } from "next/navigation";
import { PageHeader } from "@/components/page-header";
import { prisma } from "@/lib/prisma";
import { TrainingSessionClient } from "./training-session-client";

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
      slideEvents: {
        where: {
          eventType: {
            in: ["NEXT", "PREV", "JUMP"],
          },
        },
        select: {
          id: true,
        },
      },
    },
  });

  if (!session) {
    notFound();
  }

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
          initialPitchDurationSec={session.pitchDurationSec}
          initialSlideEventCount={session.slideEvents.length}
          files={session.project.fileAssets}
        />
      </div>
    </main>
  );
}
