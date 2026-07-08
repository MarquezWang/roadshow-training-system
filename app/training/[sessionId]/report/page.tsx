import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getCurrentAccessUserId } from "@/lib/auth-server";
import { getTrainingReportPageSession } from "./report-page-data";
import {
  normalizePitchRecording,
  normalizeQaQuestions,
  normalizeReportAnalysis,
} from "./report-page-normalizers";
import { isReportAnalysisStale } from "./report-page-staleness";
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
  const userId = await getCurrentAccessUserId();
  const session = await getTrainingReportPageSession(sessionId, userId);

  if (!session) {
    notFound();
  }

  if (session.status === "CREATED" || session.status === "PITCH_READY") {
    redirect(`/training/${session.id}/prepare`);
  }

  if (session.status === "PITCHING") {
    redirect(`/training/${session.id}/pitch`);
  }

  const recording = normalizePitchRecording(session.id, session.recordings);
  const analysis = normalizeReportAnalysis(session.analyses[0]);

  const isAnalysisStale = isReportAnalysisStale({
    sessionId,
    analysisStatus: analysis?.status ?? null,
    analysisUpdatedAt: session.analyses[0]?.updatedAt ?? null,
    recordings: session.recordings,
    trainingQuestions: session.trainingQuestions,
  });

  const initialAnalysis = isAnalysisStale ? null : analysis;
  const qaQuestions = normalizeQaQuestions(session.id, session.trainingQuestions);

  return (
    <main className="min-h-screen flex-1 text-[var(--foreground)]">
      <div className="mx-auto w-full max-w-7xl px-4 py-5 sm:px-6 lg:px-10">
        <div className="flex flex-col gap-4 border-b border-slate-800/80 pb-5 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="text-xs font-semibold text-teal-300">
              训练复盘工作台
            </p>
            <h1 className="mt-2 text-2xl font-semibold text-white">
              训练报告
            </h1>
            <p className="mt-1 text-sm text-slate-400">
              当前项目：{session.project.name}
            </p>
          </div>
          <Link
            href={`/projects/${session.project.id}`}
            className="inline-flex h-9 items-center justify-center rounded-md border border-slate-700 bg-slate-900/70 px-4 text-sm font-medium text-slate-100 transition-colors hover:border-teal-400/70 hover:bg-slate-800"
          >
            返回项目详情
          </Link>
        </div>

        <div className="mt-4">
          <TrainingReportClient
            sessionId={session.id}
            sessionStatus={session.status}
            qaStartedAt={session.qaStartedAt?.toISOString() ?? null}
            qaEndedAt={session.qaEndedAt?.toISOString() ?? null}
            qaDurationSec={session.qaDurationSec}
            qaQuestions={qaQuestions}
            recording={recording}
            initialAnalysis={initialAnalysis}
          />
        </div>
      </div>
    </main>
  );
}
