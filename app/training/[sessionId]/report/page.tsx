import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { PageHeader } from "@/components/page-header";
import { prisma } from "@/lib/prisma";
import { TrainingReportClient } from "./training-report-client";

type TrainingReportPageProps = Readonly<{
  params: Promise<{
    sessionId: string;
  }>;
}>;

export default async function TrainingReportPage({
  params,
}: TrainingReportPageProps) {
  const { sessionId } = await params;
  let session = await prisma.trainingSession.findUnique({
    where: {
      id: sessionId,
    },
    include: {
      project: {
        select: {
          id: true,
          name: true,
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
          mimeType: true,
          sizeBytes: true,
          durationSec: true,
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
      analyses: {
        where: {
          analysisType: "PITCH",
        },
        orderBy: {
          updatedAt: "desc",
        },
        take: 1,
        select: {
          id: true,
          status: true,
          overallScore: true,
          summary: true,
          errorMessage: true,
          updatedAt: true,
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

  if (session.status === "PITCH_ENDED" || session.status === "QA_READY") {
    session = await prisma.trainingSession.update({
      where: {
        id: session.id,
      },
      data: {
        status: "REPORT_READY",
      },
      include: {
        project: {
          select: {
            id: true,
            name: true,
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
            mimeType: true,
            sizeBytes: true,
            durationSec: true,
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
        analyses: {
          where: {
            analysisType: "PITCH",
          },
          orderBy: {
            updatedAt: "desc",
          },
          take: 1,
          select: {
            id: true,
            status: true,
            overallScore: true,
            summary: true,
            errorMessage: true,
            updatedAt: true,
          },
        },
      },
    });
  }

  const recording = session.recordings[0]
    ? {
        ...session.recordings[0],
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
  const analysis = session.analyses[0]
    ? {
        ...session.analyses[0],
        updatedAt: session.analyses[0].updatedAt.toISOString(),
      }
    : null;

  return (
    <main className="mx-auto w-full max-w-5xl flex-1 px-6 py-8 sm:px-8 lg:px-10">
      <PageHeader
        title="训练报告"
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
          href={`/training/${session.id}/qa`}
          className="inline-flex h-10 items-center justify-center rounded-md border border-slate-300 bg-white px-4 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-50"
        >
          返回答辩准备页
        </Link>
      </div>

      <div className="mt-6">
        <TrainingReportClient
          sessionId={session.id}
          recording={recording}
          initialAnalysis={analysis}
        />
      </div>
    </main>
  );
}
