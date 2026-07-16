import { notFound, redirect } from "next/navigation";
import {
  getCurrentAccessUserId,
  withSessionOwnerFilter,
} from "@/lib/auth-server";
import { prisma } from "@/lib/prisma";
import { devLog } from "@/lib/dev-log";
import {
  getDisplayMaterialNotice,
  selectDisplayablePdf,
} from "@/lib/display-material";
import { TrainingQaClient } from "./training-qa-client";

type TrainingQaPageProps = Readonly<{
  params: Promise<{
    sessionId: string;
  }>;
}>;

const qaLimitSec = 3 * 60;

export default async function TrainingQaPage({ params }: TrainingQaPageProps) {
  const { sessionId } = await params;
  const userId = await getCurrentAccessUserId();
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

  if (session.status === "ABORTED") {
    redirect(`/training/${session.id}/report`);
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

  devLog("[qa:page] rendering QA page", {
    sessionId,
    status: session.status,
    questionsCount: session.trainingQuestions.length,
    questionsSample: session.trainingQuestions.slice(0, 3).map((q) => ({
      id: q.id,
      orderIndex: q.orderIndex,
      questionText: q.questionText.slice(0, 50),
    })),
  });

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
  const previewFile = selectDisplayablePdf(session.project.fileAssets);
  const previewNotice = previewFile
    ? null
    : getDisplayMaterialNotice(session.project.fileAssets);

  return (
    <main className="w-full flex-1 bg-slate-950 p-3">
      <TrainingQaClient
        sessionId={session.id}
        projectName={session.project.name}
        initialStatus={session.status}
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
        previewNotice={previewNotice}
        dynamicFollowupExperiment={
          process.env.DYNAMIC_FOLLOWUP_EXPERIMENT === "true"
        }
      />
    </main>
  );
}
