import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getCurrentAccessUserId, withSessionOwnerFilter } from "@/lib/auth-server";
import { prisma } from "@/lib/prisma";
import {
  parseActionItems,
  parseDiagnostics,
  parseDynamicFollowupReview,
  parseJsonArray,
  parseJsonObject,
  parseOnePageSummary,
} from "./report-page-parsers";
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
  const session = await prisma.trainingSession.findFirst({
    where: withSessionOwnerFilter({ id: sessionId }, userId),
    include: {
      project: {
        select: {
          id: true,
          name: true,
        },
      },
      recordings: {
        orderBy: {
          createdAt: "desc",
        },
        select: {
          id: true,
          phase: true,
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
          strengthsJson: true,
          weaknessesJson: true,
          suggestionsJson: true,
          coverageJson: true,
          timingJson: true,
          slideSyncJson: true,
          riskQuestionsJson: true,
          rawResultJson: true,
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
              recording: {
                select: {
                  id: true,
                  phase: true,
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

  const pitchRecording =
    session.recordings.find(
      (recording) => recording.phase === "PITCH" && recording.transcript,
    ) ??
    session.recordings.find((recording) => recording.phase === "PITCH") ??
    null;
  const recording = pitchRecording
    ? {
        ...pitchRecording,
        playbackUrl: `/training/${session.id}/recordings/${pitchRecording.id}`,
        transcript: pitchRecording.transcript
          ? {
              ...pitchRecording.transcript,
              startedAt:
                pitchRecording.transcript.startedAt?.toISOString() ??
                null,
              completedAt:
                pitchRecording.transcript.completedAt?.toISOString() ??
                null,
              createdAt: pitchRecording.transcript.createdAt.toISOString(),
              updatedAt: pitchRecording.transcript.updatedAt.toISOString(),
            }
          : null,
      }
    : null;
  const analysis = session.analyses[0]
    ? (() => {
        const rawResult = parseJsonObject(session.analyses[0].rawResultJson);

        return {
          id: session.analyses[0].id,
          status: session.analyses[0].status,
          overallScore: session.analyses[0].overallScore,
          summary: session.analyses[0].summary,
          errorMessage: session.analyses[0].errorMessage,
          updatedAt: session.analyses[0].updatedAt.toISOString(),
          strengths: parseJsonArray<string>(session.analyses[0].strengthsJson),
          weaknesses: parseJsonArray<string>(session.analyses[0].weaknessesJson),
          suggestions: parseJsonArray<string>(session.analyses[0].suggestionsJson),
          onePageSummary: parseOnePageSummary(rawResult.onePageSummary),
          diagnostics: parseDiagnostics(rawResult.diagnostics),
          actionItems: parseActionItems(rawResult.actionItems),
          nextTrainingTasks: Array.isArray(rawResult.nextTrainingTasks)
            ? rawResult.nextTrainingTasks.filter(
                (item): item is string =>
                  typeof item === "string" && item.trim().length > 0,
              )
            : [],
          contentCoverage: parseJsonArray<{ item: string; covered: string; evidence: string; suggestion: string }>(session.analyses[0].coverageJson),
          timing: parseJsonObject(session.analyses[0].timingJson),
          slideSync: parseJsonObject(session.analyses[0].slideSyncJson),
          riskQuestions: parseJsonArray<string>(session.analyses[0].riskQuestionsJson),
          qaReviews: Array.isArray(rawResult.qaReviews) ? rawResult.qaReviews : [],
          dynamicFollowupReview: parseDynamicFollowupReview(
            rawResult.dynamicFollowupReview,
          ),
        };
      })()
    : null;

  // 检测 stale analysis：如果 analysis 已完成但存在 transcript 晚于 analysis.updatedAt
  // 则 analysis 可能使用了旧的/不完整的 transcript 输入，视为 stale
  let isAnalysisStale = false;
  if (analysis && analysis.status === "COMPLETED") {
    const analysisUpdatedAt = session.analyses[0]!.updatedAt.getTime();
    const allTranscripts = [
      ...session.recordings
        .filter((r) => r.transcript?.completedAt)
        .map((r) => r.transcript!.completedAt!.getTime()),
      ...session.trainingQuestions
        .filter((q) => q.answer?.recording?.transcript?.completedAt)
        .map((q) => q.answer!.recording!.transcript!.completedAt!.getTime()),
    ];
    if (allTranscripts.length > 0) {
      const latestTranscriptTime = Math.max(...allTranscripts);
      if (latestTranscriptTime > analysisUpdatedAt) {
        console.log("[report:page] stale analysis detected, will trigger regeneration", {
          sessionId,
          analysisUpdatedAt: new Date(analysisUpdatedAt).toISOString(),
          latestTranscriptTime: new Date(latestTranscriptTime).toISOString(),
        });
        isAnalysisStale = true;
      }
    }
  }

  const initialAnalysis = isAnalysisStale ? null : analysis;
  const qaQuestions = session.trainingQuestions.map((question) => ({
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
          recording: question.answer.recording
            ? {
                id: question.answer.recording.id,
                phase: question.answer.recording.phase,
                playbackUrl: `/training/${session.id}/recordings/${question.answer.recording.id}`,
                mimeType: question.answer.recording.mimeType,
                sizeBytes: question.answer.recording.sizeBytes,
                durationSec: question.answer.recording.durationSec,
                transcript: question.answer.recording.transcript
                  ? {
                      ...question.answer.recording.transcript,
                      startedAt:
                        question.answer.recording.transcript.startedAt?.toISOString() ??
                        null,
                      completedAt:
                        question.answer.recording.transcript.completedAt?.toISOString() ??
                        null,
                      createdAt: question.answer.recording.transcript.createdAt.toISOString(),
                      updatedAt: question.answer.recording.transcript.updatedAt.toISOString(),
                    }
                  : null,
              }
            : null,
        }
      : null,
  }));

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
