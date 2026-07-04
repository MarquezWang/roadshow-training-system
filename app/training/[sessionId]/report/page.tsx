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
    <main className="mx-auto min-h-screen w-full max-w-5xl flex-1 px-6 py-4 text-[var(--foreground)] sm:px-8 lg:px-10">
      <div className="flex flex-col gap-3 border-b border-[var(--border)] pb-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-xl font-semibold text-[var(--foreground)]">
            训练报告
          </h1>
          <p className="mt-1 text-xs text-[var(--muted-foreground)]">
            当前项目：{session.project.name}
          </p>
        </div>
        <Link
          href={`/projects/${session.project.id}`}
          className="inline-flex h-8 items-center justify-center rounded-md border border-slate-600 bg-slate-900 px-3 text-xs font-medium text-slate-100 transition-colors hover:border-slate-500 hover:bg-slate-800"
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
    </main>
  );
}
