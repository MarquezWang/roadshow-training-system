import { prisma } from "@/lib/prisma";
import type { TrainingAnalysisQuestionData } from "@/lib/training-analysis-fallback-builder";

const TRANSCRIPT_WAIT_TIMEOUT_MS = 90_000;

export async function findTrainingAnalysisSession(sessionId: string) {
  return prisma.trainingSession.findUnique({
    where: { id: sessionId },
    include: {
      slideEvents: {
        orderBy: { createdAt: "asc" },
        select: {
          eventType: true,
          pageIndex: true,
          elapsedSec: true,
          createdAt: true,
        },
      },
      transcripts: {
        where: {
          status: "COMPLETED",
          text: { not: "" },
          recording: { phase: "PITCH" },
        },
        orderBy: { updatedAt: "desc" },
        take: 1,
        select: {
          id: true,
          text: true,
          source: true,
          language: true,
          completedAt: true,
          updatedAt: true,
        },
      },
      trainingQuestions: {
        orderBy: { orderIndex: "asc" },
        select: {
          id: true,
          orderIndex: true,
          questionText: true,
          questionType: true,
          source: true,
          answer: {
            select: {
              id: true,
              startedAt: true,
              durationSec: true,
              answerText: true,
              endedAt: true,
              recording: {
                select: {
                  id: true,
                  transcript: {
                    select: {
                      text: true,
                      status: true,
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
}

export type TrainingAnalysisSession = NonNullable<
  Awaited<ReturnType<typeof findTrainingAnalysisSession>>
>;

export type TrainingAnalysisTranscriptWaitState =
  | Readonly<{ kind: "ready" }>
  | Readonly<{
      kind: "pitch";
      transcriptStatus: string;
    }>
  | Readonly<{
      kind: "qa";
      pendingCount: number;
    }>;

function isDynamicFollowupQuestion(question: {
  source?: string | null;
  questionType?: string | null;
}) {
  return (
    question.source === "DYNAMIC_FOLLOWUP" ||
    question.questionType === "FOLLOWUP"
  );
}

function hasEnteredAnswer(
  answer: {
    startedAt?: Date | null;
    endedAt?: Date | null;
    answerText?: string | null;
    recording?: { id: string } | null;
  } | null,
) {
  return Boolean(
    answer?.startedAt ||
    answer?.endedAt ||
    answer?.recording ||
    answer?.answerText?.trim(),
  );
}

function hasTranscriptWaitTimedOut(
  startedAt: Date | null | undefined,
  nowMs: number,
) {
  return startedAt
    ? nowMs - startedAt.getTime() > TRANSCRIPT_WAIT_TIMEOUT_MS
    : false;
}

export function canGenerateTrainingAnalysis(session: TrainingAnalysisSession) {
  return (
    [
      "PITCH_ENDED",
      "QA_READY",
      "QA_ENDED",
      "REPORT_READY",
      "FINISHED",
    ].includes(session.status) && Boolean(session.pitchEndedAt)
  );
}

export async function getTrainingAnalysisTranscriptWaitState(
  session: TrainingAnalysisSession,
): Promise<TrainingAnalysisTranscriptWaitState> {
  const transcript = session.transcripts[0] ?? null;
  const transcriptMissing = !transcript?.text.trim();
  const nowMs = Date.now();

  if (transcriptMissing) {
    const pitchRecording = await prisma.trainingRecording.findFirst({
      where: {
        sessionId: session.id,
        phase: "PITCH",
      },
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        createdAt: true,
        updatedAt: true,
        transcript: {
          select: { id: true, status: true, updatedAt: true },
        },
      },
    });
    const pitchWaitStartedAt =
      pitchRecording?.transcript?.updatedAt ??
      pitchRecording?.updatedAt ??
      pitchRecording?.createdAt ??
      session.pitchEndedAt;
    const pitchCanDegrade = hasTranscriptWaitTimedOut(
      pitchWaitStartedAt,
      nowMs,
    );
    const pitchTranscriptWaiting = Boolean(
      pitchRecording &&
      (!pitchRecording.transcript ||
        ["PENDING", "PROCESSING"].includes(pitchRecording.transcript.status)),
    );

    if (pitchTranscriptWaiting && !pitchCanDegrade) {
      return {
        kind: "pitch",
        transcriptStatus: pitchRecording?.transcript?.status ?? "MISSING",
      };
    }
  }

  const qaEndedTime = session.qaEndedAt?.getTime();
  const latestQaAnswerTime = session.trainingQuestions
    .filter(
      (question) =>
        hasEnteredAnswer(question.answer) && question.answer?.endedAt,
    )
    .map((question) => question.answer!.endedAt!.getTime())
    .sort((left, right) => right - left)[0];
  const qaBaselineTime = qaEndedTime ?? latestQaAnswerTime;
  const canDegrade = qaBaselineTime
    ? nowMs - qaBaselineTime > TRANSCRIPT_WAIT_TIMEOUT_MS
    : false;
  const enteredQaRecordingIds = session.trainingQuestions
    .filter(
      (question) =>
        hasEnteredAnswer(question.answer) && question.answer?.recording?.id,
    )
    .map((question) => question.answer!.recording!.id);

  if (!canDegrade && enteredQaRecordingIds.length > 0) {
    const pendingQaRecordings = await prisma.trainingRecording.findMany({
      where: {
        sessionId: session.id,
        id: { in: enteredQaRecordingIds },
        phase: "QA",
      },
      select: {
        id: true,
        transcript: { select: { status: true } },
      },
    });
    const pendingCount = pendingQaRecordings.filter(
      (recording) =>
        !recording.transcript ||
        ["PENDING", "PROCESSING"].includes(recording.transcript.status),
    ).length;

    if (pendingCount > 0) {
      return { kind: "qa", pendingCount };
    }
  }

  return { kind: "ready" };
}

function mapQuestionToAnalysisData(
  question: TrainingAnalysisSession["trainingQuestions"][number],
): TrainingAnalysisQuestionData {
  const transcribeStatus =
    question.answer?.recording?.transcript?.status ?? null;
  const transcribeText = question.answer?.recording?.transcript?.text ?? null;
  const isPendingOrProcessing =
    transcribeStatus === "PENDING" || transcribeStatus === "PROCESSING";

  return {
    questionId: question.id,
    orderIndex: question.orderIndex,
    questionType: question.questionType,
    source: question.source,
    questionText: question.questionText,
    answerDurationSec: question.answer?.durationSec ?? null,
    answerText: question.answer?.answerText ?? null,
    transcribeText,
    transcribeStatus,
    transcribeFailed: transcribeStatus === "FAILED",
    transcribePending: isPendingOrProcessing,
    transcribeNote:
      transcribeStatus === "FAILED"
        ? "该题转写失败，分析依据可能不足，请基于答题时长和项目材料进行有限分析。"
        : isPendingOrProcessing
          ? "该题转写超时未完成，分析依据不足，请基于项目材料和答题时长进行有限分析。"
          : null,
  };
}

export function prepareTrainingAnalysisInput(session: TrainingAnalysisSession) {
  const transcript = session.transcripts[0] ?? null;
  const transcriptMissing = !transcript?.text.trim();
  const pitchEndedAt = session.pitchEndedAt;

  if (!pitchEndedAt) {
    throw new Error("请先结束路演后再分析。");
  }

  const durationSec =
    session.pitchDurationSec ??
    Math.max(
      0,
      Math.round(
        (pitchEndedAt.getTime() -
          (session.pitchStartedAt?.getTime() ?? pitchEndedAt.getTime())) /
          1000,
      ),
    );
  const pageIndexes = session.slideEvents
    .map((event) => event.pageIndex)
    .filter((pageIndex): pageIndex is number => pageIndex !== null);
  const pageCount = pageIndexes.length > 0 ? new Set(pageIndexes).size : null;
  const enteredQuestions = session.trainingQuestions.filter((question) =>
    hasEnteredAnswer(question.answer),
  );
  const qaData = enteredQuestions
    .filter((question) => !isDynamicFollowupQuestion(question))
    .map(mapQuestionToAnalysisData);
  const dynamicFollowupQuestion =
    enteredQuestions.find(isDynamicFollowupQuestion) ?? null;
  const dynamicFollowupData = dynamicFollowupQuestion
    ? mapQuestionToAnalysisData(dynamicFollowupQuestion)
    : null;
  const hasAnalyzableText =
    !transcriptMissing ||
    qaData.some(
      (question) =>
        Boolean(question.answerText?.trim()) ||
        Boolean(question.transcribeText?.trim()),
    ) ||
    Boolean(dynamicFollowupData?.answerText?.trim()) ||
    Boolean(dynamicFollowupData?.transcribeText?.trim());

  return {
    transcript,
    transcriptMissing,
    durationSec,
    pageCount,
    slideEventCount: session.slideEvents.length,
    qaData,
    dynamicFollowupData,
    hasAnalyzableText,
  };
}

export function buildTrainingAnalysisPromptInput(
  session: TrainingAnalysisSession,
  input: ReturnType<typeof prepareTrainingAnalysisInput>,
) {
  return {
    session: {
      id: session.id,
      status: session.status,
      pitchStartedAt: session.pitchStartedAt?.toISOString() ?? null,
      pitchEndedAt: session.pitchEndedAt?.toISOString() ?? null,
      pitchDurationSec: input.durationSec,
      currentPageIndex: session.currentPageIndex,
    },
    slideEvents: session.slideEvents.map((event) => ({
      eventType: event.eventType,
      pageIndex: event.pageIndex,
      elapsedSec: event.elapsedSec,
      createdAt: event.createdAt.toISOString(),
    })),
    transcript: input.transcript
      ? {
          id: input.transcript.id,
          source: input.transcript.source,
          language: input.transcript.language,
          completedAt: input.transcript.completedAt?.toISOString() ?? null,
          text: input.transcript.text,
        }
      : {
          id: null,
          source: "NONE",
          language: "zh-CN",
          completedAt: null,
          text: input.transcriptMissing
            ? "【路演转写缺失】路演录音转写失败或超时，分析将基于项目材料、答辩数据及录音元信息降级进行。"
            : "",
        },
    qaData: input.qaData,
    dynamicFollowupData: input.dynamicFollowupData,
  };
}
