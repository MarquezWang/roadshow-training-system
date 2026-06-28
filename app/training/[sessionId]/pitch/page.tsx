import { notFound, redirect } from "next/navigation";
import { PageHeader } from "@/components/page-header";
import { getCurrentAuthUserId, withSessionOwnerFilter } from "@/lib/auth-server";
import {
  getDisplayMaterialNotice,
  selectDisplayablePdf,
} from "@/lib/display-material";
import { prisma } from "@/lib/prisma";
import { TrainingSessionClient } from "../training-session-client";

const pitchLimitSec = 9 * 60;

type TrainingSessionPageProps = Readonly<{
  params: Promise<{
    sessionId: string;
  }>;
}>;

type TrainingCoverageItem = {
  item: string;
  covered: "true" | "false" | "partial";
  evidence: string;
  suggestion: string;
};

function parseStoredJson<T>(value: string, fallback: T): T {
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

export default async function TrainingSessionPage({
  params,
}: TrainingSessionPageProps) {
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
          phase: true,
          status: true,
          fileName: true,
          mimeType: true,
          sizeBytes: true,
          durationSec: true,
          startedAt: true,
          endedAt: true,
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
          sessionId: true,
          projectId: true,
          transcriptId: true,
          status: true,
          analysisType: true,
          durationSec: true,
          pageCount: true,
          slideEventCount: true,
          overallScore: true,
          summary: true,
          strengthsJson: true,
          weaknessesJson: true,
          suggestionsJson: true,
          coverageJson: true,
          timingJson: true,
          slideSyncJson: true,
          riskQuestionsJson: true,
          rawResultJson: true,
          errorMessage: true,
          createdAt: true,
          updatedAt: true,
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

  const [serverClock] = await prisma.$queryRaw<Array<{ nowSec: number }>>`
    SELECT CAST(strftime('%s', 'now') AS INTEGER) AS nowSec
  `;
  const serverNowSec = Number(serverClock?.nowSec ?? 0);
  const initialElapsedSec =
    session.pitchDurationSec ??
    (session.status === "PITCHING" && session.pitchStartedAt
      ? Math.max(
          0,
          serverNowSec - Math.floor(session.pitchStartedAt.getTime() / 1000),
        )
      : 0);
  const initialRemainingSec = Math.max(0, pitchLimitSec - initialElapsedSec);
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
  const initialRecording = session.recordings[0]
    ? {
        ...session.recordings[0],
        startedAt: session.recordings[0].startedAt?.toISOString() ?? null,
        endedAt: session.recordings[0].endedAt?.toISOString() ?? null,
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
  const latestAnalysis = session.analyses[0];
  const initialAnalysis = latestAnalysis
    ? {
        id: latestAnalysis.id,
        sessionId: latestAnalysis.sessionId,
        projectId: latestAnalysis.projectId,
        transcriptId: latestAnalysis.transcriptId,
        status: latestAnalysis.status,
        analysisType: latestAnalysis.analysisType,
        durationSec: latestAnalysis.durationSec,
        pageCount: latestAnalysis.pageCount,
        slideEventCount: latestAnalysis.slideEventCount,
        overallScore: latestAnalysis.overallScore,
        summary: latestAnalysis.summary,
        strengths: parseStoredJson<string[]>(latestAnalysis.strengthsJson, []),
        weaknesses: parseStoredJson<string[]>(
          latestAnalysis.weaknessesJson,
          [],
        ),
        suggestions: parseStoredJson<string[]>(
          latestAnalysis.suggestionsJson,
          [],
        ),
        coverage: parseStoredJson<TrainingCoverageItem[]>(
          latestAnalysis.coverageJson,
          [],
        ),
        timing: parseStoredJson<Record<string, unknown>>(
          latestAnalysis.timingJson,
          {},
        ),
        slideSync: parseStoredJson<Record<string, unknown>>(
          latestAnalysis.slideSyncJson,
          {},
        ),
        riskQuestions: parseStoredJson<string[]>(
          latestAnalysis.riskQuestionsJson,
          [],
        ),
        rawResult: parseStoredJson<Record<string, unknown>>(
          latestAnalysis.rawResultJson,
          {},
        ),
        errorMessage: latestAnalysis.errorMessage,
        createdAt: latestAnalysis.createdAt.toISOString(),
        updatedAt: latestAnalysis.updatedAt.toISOString(),
      }
    : null;

  return (
    <main className="mx-auto w-full max-w-6xl flex-1 px-6 py-8 sm:px-8 lg:px-10">
      <PageHeader
        title="路演训练"
        description={`当前项目：${session.project.name}`}
      />

      <div className="mt-6">
        <TrainingSessionClient
          sessionId={session.id}
          projectId={session.project.id}
          projectName={session.project.name}
          initialStatus={session.status}
          initialPageIndex={Math.max(0, session.currentPageIndex - 1)}
          initialPitchStartedAt={session.pitchStartedAt?.toISOString() ?? null}
          initialElapsedSec={initialElapsedSec}
          initialRemainingSec={initialRemainingSec}
          initialPitchDurationSec={session.pitchDurationSec}
          files={aiContextFiles}
          previewFile={previewFile}
          previewNotice={previewNotice}
          initialRecording={initialRecording}
          initialAnalysis={initialAnalysis}
          autoStartRecordingOnMount
          redirectToQaAfterPitchEnd
          showAnalysisPanel={false}
        />
      </div>
    </main>
  );
}
