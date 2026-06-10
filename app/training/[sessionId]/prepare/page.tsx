import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { PageHeader } from "@/components/page-header";
import { prisma } from "@/lib/prisma";
import { TrainingPrepareClient } from "./training-prepare-client";

type TrainingPreparePageProps = Readonly<{
  params: Promise<{
    sessionId: string;
  }>;
}>;

export default async function TrainingPreparePage({
  params,
}: TrainingPreparePageProps) {
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

  if (session.status === "PITCHING") {
    redirect(`/training/${session.id}/pitch`);
  }

  if (
    session.status === "PITCH_ENDED" ||
    session.status === "QA_READY" ||
    session.status === "QAING"
  ) {
    redirect(`/training/${session.id}/qa`);
  }

  if (
    session.status === "QA_ENDED" ||
    session.status === "REPORT_READY" ||
    session.status === "FINISHED"
  ) {
    redirect(`/training/${session.id}/report`);
  }

  const previewFile =
    session.project.fileAssets.find(
      (file) => file.fileType.toLowerCase() === "pdf",
    ) ?? null;

  return (
    <main className="mx-auto w-full max-w-6xl flex-1 px-6 py-8 sm:px-8 lg:px-10">
      <PageHeader
        title="训练准备"
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
        <TrainingPrepareClient
          sessionId={session.id}
          projectId={session.project.id}
          projectName={session.project.name}
          files={session.project.fileAssets}
          previewFile={previewFile}
        />
      </div>
    </main>
  );
}
