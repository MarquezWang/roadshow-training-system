import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { PageHeader } from "@/components/page-header";
import { prisma } from "@/lib/prisma";

type TrainingQaPageProps = Readonly<{
  params: Promise<{
    sessionId: string;
  }>;
}>;

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

  return (
    <main className="mx-auto w-full max-w-5xl flex-1 px-6 py-8 sm:px-8 lg:px-10">
      <PageHeader
        title="答辩准备"
        description={`当前项目：${session.project.name}`}
      />

      <section className="mt-6 rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
        <p className="text-sm font-medium text-slate-500">路演已结束</p>
        <h2 className="mt-2 text-2xl font-semibold text-slate-950">
          即将进入模拟答辩
        </h2>
        <div className="mt-5 grid gap-3 text-sm leading-6 text-slate-700">
          <p>答辩时间：3 分钟。</p>
          <p>
            后续将由系统根据项目材料、路演表现和评审规则生成评委问题。
          </p>
          <p>
            本阶段只提供答辩占位流程，不开发完整答辩录音、评分或反馈。
          </p>
        </div>

        <div className="mt-6 flex flex-col gap-3 sm:flex-row">
          <Link
            href={`/training/${session.id}/report`}
            className="inline-flex h-10 items-center justify-center rounded-md bg-slate-950 px-4 text-sm font-medium text-white transition-colors hover:bg-slate-800"
          >
            进入报告页
          </Link>
          <button
            type="button"
            disabled
            className="inline-flex h-10 items-center justify-center rounded-md border border-slate-300 bg-slate-100 px-4 text-sm font-medium text-slate-400"
          >
            开始答辩（暂未开放）
          </button>
          <Link
            href={`/projects/${session.project.id}`}
            className="inline-flex h-10 items-center justify-center rounded-md border border-slate-300 bg-white px-4 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-50"
          >
            返回项目详情
          </Link>
        </div>
      </section>
    </main>
  );
}
