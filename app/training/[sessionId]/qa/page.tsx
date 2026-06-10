import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { PageHeader } from "@/components/page-header";
import { prisma } from "@/lib/prisma";
import { TrainingQaClient } from "./training-qa-client";

type TrainingQaPageProps = Readonly<{
  params: Promise<{
    sessionId: string;
  }>;
}>;

const qaLimitSec = 3 * 60;

export default async function TrainingQaPage({ params }: TrainingQaPageProps) {
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
      trainingQuestions: {
        orderBy: {
          orderIndex: "asc",
        },
        include: {
          answer: {
            select: {
              id: true,
              answerText: true,
              revealedQuestionText: true,
              startedAt: true,
              endedAt: true,
              durationSec: true,
            },
          },
        },
      },
    },
  });

  if (!session) {
    notFound();
  }

  if (session.status === "CREATED" || session.status === "PITCH_READY") {
    redirect(`/training/${session.id}/prepare`);
  }

  if (session.status === "PITCHING") {
    redirect(`/training/${session.id}/pitch`);
  }

  if (
    session.status === "QA_ENDED" ||
    session.status === "REPORT_READY" ||
    session.status === "FINISHED"
  ) {
    redirect(`/training/${session.id}/report`);
  }

  const [serverClock] = await prisma.$queryRaw<Array<{ nowSec: number }>>`
    SELECT CAST(strftime('%s', 'now') AS INTEGER) AS nowSec
  `;
  const serverNowSec = Number(serverClock?.nowSec ?? 0);
  const qaElapsedSec =
    session.status === "QAING" && session.qaStartedAt
      ? Math.max(
          0,
          serverNowSec - Math.floor(session.qaStartedAt.getTime() / 1000),
        )
      : 0;
  const initialRemainingSec = Math.max(0, qaLimitSec - qaElapsedSec);
  const previewFile =
    session.project.fileAssets.find(
      (file) => file.fileType.toLowerCase() === "pdf",
    ) ?? null;

  return (
    <main className="mx-auto w-full max-w-7xl flex-1 px-6 py-8 sm:px-8 lg:px-10">
      <PageHeader
        title="语音评委答辩舱"
        description={`当前项目：${session.project.name}`}
      />

      <div className="mt-6 flex flex-col gap-3 sm:flex-row">
        <Link
          href={`/projects/${session.project.id}`}
          className="inline-flex h-10 items-center justify-center rounded-md border border-slate-300 bg-white px-4 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-50"
        >
          返回项目详情
        </Link>
        <Link
          href={`/training/${session.id}/report`}
          className="inline-flex h-10 items-center justify-center rounded-md border border-slate-300 bg-white px-4 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-50"
        >
          进入报告页
        </Link>
      </div>

      <div className="mt-6">
        <TrainingQaClient
          sessionId={session.id}
          projectName={session.project.name}
          initialStatus={session.status}
          initialQaStartedAt={session.qaStartedAt?.toISOString() ?? null}
          initialRemainingSec={initialRemainingSec}
          initialQuestions={session.trainingQuestions.map((question) => ({
            id: question.id,
            orderIndex: question.orderIndex,
            questionText: question.questionText,
            questionType: question.questionType,
            source: question.source,
            basis: question.basis,
            answer: question.answer
              ? {
                  id: question.answer.id,
                  answerText: question.answer.answerText,
                  revealedQuestionText: question.answer.revealedQuestionText,
                  startedAt: question.answer.startedAt?.toISOString() ?? null,
                  endedAt: question.answer.endedAt?.toISOString() ?? null,
                  durationSec: question.answer.durationSec,
                }
              : null,
          }))}
          previewFile={previewFile}
          files={session.project.fileAssets}
        />
      </div>
    </main>
  );
}
