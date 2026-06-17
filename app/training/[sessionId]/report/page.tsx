import Link from "next/link";
import { notFound, redirect } from "next/navigation";
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
  function parseJsonArray<T>(value: string | null | undefined): T[] {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function parseJsonObject(value: string | null | undefined): Record<string, unknown> {
  if (!value) return {};
  try {
    const parsed = JSON.parse(value);
    return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {};
  } catch {
    return {};
  }
}

function parseDynamicFollowupReview(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  const record = value as Record<string, unknown>;
  const readString = (key: string) =>
    typeof record[key] === "string" ? record[key] : "";

  return {
    questionId: readString("questionId"),
    question: readString("question"),
    answerSummary: readString("answerSummary"),
    targetWeakness: readString("targetWeakness"),
    evidenceSupplement: readString("evidenceSupplement"),
    improvementAdvice: readString("improvementAdvice"),
  };
}

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
    <main className="mx-auto w-full max-w-5xl flex-1 px-6 py-4 sm:px-8 lg:px-10">
      <div className="flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-xl font-semibold text-slate-900">训练报告</h1>
          <p className="text-xs text-slate-400">
            当前项目：{session.project.name}
          </p>
        </div>
        <Link
          href={`/projects/${session.project.id}`}
          className="inline-flex h-7 items-center rounded-md border border-slate-200 bg-white px-2.5 text-xs font-medium text-slate-500 transition-colors hover:border-slate-300 hover:text-slate-700"
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
