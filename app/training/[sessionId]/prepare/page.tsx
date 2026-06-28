import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getCurrentAuthUserId, withSessionOwnerFilter } from "@/lib/auth-server";
import { prisma } from "@/lib/prisma";
import {
  getDisplayMaterialNotice,
  selectDisplayablePdf,
} from "@/lib/display-material";
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
  const userId = await getCurrentAuthUserId();
  const session = await prisma.trainingSession.findFirst({
    where: withSessionOwnerFilter({ id: sessionId }, userId),
    include: {
      project: {
        select: {
          id: true,
          name: true,
          fileAssets: {
            orderBy: {
              createdAt: "asc",
            },
            select: {
              id: true,
              originalName: true,
              fileType: true,
              extractedText: true,
              parseStatus: true,
              includeInAIContext: true,
              previewPdfPath: true,
              previewStatus: true,
              previewError: true,
            },
          },
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

  if (session.status === "PITCHING") {
    redirect(`/training/${session.id}/pitch`);
  }

  if (
    session.status === "PITCH_ENDED" ||
    session.status === "QA_READY"
  ) {
    redirect(`/training/${session.id}/qa-prepare`);
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

  const aiContextFiles = session.project.fileAssets.filter(
    (file) =>
      file.parseStatus === "SUCCESS" &&
      file.includeInAIContext &&
      Boolean(file.extractedText),
  );
  const previewFile = selectDisplayablePdf(session.project.fileAssets);
  const previewNotice = previewFile
    ? null
    : getDisplayMaterialNotice(session.project.fileAssets);

  return (
    <main className="mx-auto min-h-screen w-full max-w-6xl flex-1 px-6 py-8 text-[var(--foreground)] sm:px-8 lg:px-10">
      <div className="flex flex-col gap-4 border-b border-[var(--border)] pb-6 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-[var(--foreground)]">
            训练准备
          </h1>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-[var(--muted-foreground)]">
            当前项目：{session.project.name}
          </p>
        </div>
        <div className="flex flex-col gap-3 sm:flex-row">
          <Link
            href={`/projects/${session.project.id}`}
            className="inline-flex h-10 items-center justify-center rounded-md border border-slate-600 bg-slate-900 px-4 text-sm font-medium text-slate-100 transition-colors hover:border-slate-500 hover:bg-slate-800"
          >
            返回项目详情
          </Link>
        </div>
      </div>

      <div className="mt-6">
        <TrainingPrepareClient
          sessionId={session.id}
          projectId={session.project.id}
          projectName={session.project.name}
          files={aiContextFiles}
          previewFile={previewFile}
          previewNotice={previewNotice}
        />
      </div>
    </main>
  );
}
