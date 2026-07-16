import { notFound } from "next/navigation";
import { getCurrentAccessUserId, withSessionOwnerFilter } from "@/lib/auth-server";
import {
  getDisplayMaterialNotice,
  selectDisplayablePdf,
} from "@/lib/display-material";
import { prisma } from "@/lib/prisma";
import { TrainingReplayClient } from "./training-replay-client";

type TrainingReplayPageProps = Readonly<{
  params: Promise<{
    sessionId: string;
  }>;
}>;

export default async function TrainingReplayPage({
  params,
}: TrainingReplayPageProps) {
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
              previewPdfPath: true,
              previewStatus: true,
              previewError: true,
            },
          },
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
      slideEvents: {
        orderBy: [
          {
            elapsedSec: "asc",
          },
          {
            createdAt: "asc",
          },
        ],
        select: {
          id: true,
          fileId: true,
          pageIndex: true,
          eventType: true,
          elapsedSec: true,
          createdAt: true,
        },
      },
    },
  });

  if (!session) {
    notFound();
  }

  const primaryFileId =
    session.primaryFileId ??
    session.slideEvents.find((event) => event.eventType === "START")?.fileId ??
    null;
  const previewCandidates = primaryFileId
    ? session.project.fileAssets.filter((file) => file.id === primaryFileId)
    : session.project.fileAssets;
  const previewFile = selectDisplayablePdf(previewCandidates);
  const previewNotice = previewFile
    ? null
    : (getDisplayMaterialNotice(previewCandidates)?.message ?? null);

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
        startedAt: pitchRecording.startedAt?.toISOString() ?? null,
        endedAt: pitchRecording.endedAt?.toISOString() ?? null,
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
  const slideEvents = session.slideEvents.map((event) => ({
    ...event,
    createdAt: event.createdAt.toISOString(),
  }));

  return (
    <TrainingReplayClient
      sessionId={session.id}
      projectId={session.project.id}
      projectName={session.project.name}
      recording={recording}
      pitchDurationSec={session.pitchDurationSec}
      previewFile={previewFile}
      previewNotice={previewNotice}
      slideEvents={slideEvents}
    />
  );
}
