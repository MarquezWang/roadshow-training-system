import { transcriptSelect } from "./constants.mjs";
import { isUniqueConstraintError } from "./state.mjs";

export async function prepareProcessingTranscript(
  prisma,
  { recording, transcript, now },
) {
  let processingTranscript = transcript;
  if (transcript) {
    const prepared = await prisma.trainingTranscript.updateMany({
      where: {
        id: transcript.id,
        revision: transcript.revision,
        NOT: {
          status: "COMPLETED",
          source: "MANUAL",
        },
      },
      data: {
        status: "PROCESSING",
        source: "ASR_PROVIDER",
        language: "zh-CN",
        text: "",
        segmentsJson: null,
        errorMessage: null,
        startedAt: now,
        completedAt: null,
        revision: { increment: 1 },
      },
    });
    if (prepared.count === 1) {
      processingTranscript = await prisma.trainingTranscript.findUniqueOrThrow({
        where: { id: transcript.id },
        select: transcriptSelect,
      });
    }
  } else {
    try {
      processingTranscript = await prisma.trainingTranscript.create({
        data: {
          recordingId: recording.id,
          sessionId: recording.sessionId,
          projectId: recording.projectId,
          status: "PROCESSING",
          source: "ASR_PROVIDER",
          language: "zh-CN",
          text: "",
          startedAt: now,
          revision: 1,
        },
        select: transcriptSelect,
      });
    } catch (error) {
      if (!isUniqueConstraintError(error)) throw error;
    }
  }

  return processingTranscript;
}
