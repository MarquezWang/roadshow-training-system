import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

type ReportStatusContext = Readonly<{
  params: Promise<{
    sessionId: string;
  }>;
}>;

export async function GET(
  _request: NextRequest,
  context: ReportStatusContext,
) {
  const { sessionId } = await context.params;

  const session = await prisma.trainingSession.findUnique({
    where: { id: sessionId },
    select: {
      id: true,
      status: true,
      pitchEndedAt: true,
      qaEndedAt: true,
    },
  });

  if (!session) {
    return NextResponse.json({ error: "训练场次不存在。" }, { status: 404 });
  }

  // 获取 analysis
  const analysis = await prisma.trainingAnalysis.findFirst({
    where: {
      sessionId,
      analysisType: "PITCH",
    },
    orderBy: { updatedAt: "desc" },
    select: {
      id: true,
      status: true,
      errorMessage: true,
      updatedAt: true,
    },
  });

  // 获取 Pitch transcript 状态
  const pitchTranscript = await prisma.trainingTranscript.findFirst({
    where: {
      sessionId,
      recording: { phase: "PITCH" },
    },
    orderBy: { updatedAt: "desc" },
    select: {
      id: true,
      status: true,
      completedAt: true,
      updatedAt: true,
    },
  });

  // 获取 QA 回答及转写状态（通过 TrainingAnswer 关联 question → recording → transcript）
  const qaAnswers = await prisma.trainingAnswer.findMany({
    where: {
      sessionId,
    },
    select: {
      id: true,
      questionId: true,
      recordingId: true,
      answerText: true,
      startedAt: true,
      endedAt: true,
      question: {
        select: {
          id: true,
        },
      },
      recording: {
        select: {
          id: true,
          transcript: {
            select: {
              id: true,
              status: true,
              text: true,
              completedAt: true,
              updatedAt: true,
            },
          },
        },
      },
    },
  });

  const qaQuestions = await prisma.trainingQuestion.findMany({
    where: {
      sessionId,
    },
    select: {
      id: true,
      source: true,
      questionType: true,
    },
  });

  const enteredQaAnswers = qaAnswers.filter((answer) =>
    Boolean(
      answer.startedAt ||
        answer.endedAt ||
        answer.recordingId ||
        answer.answerText?.trim(),
    ),
  );

  // 生成 qaTranscriptItems：每道实际进入过的题一条轻量状态
  const qaTranscriptItems = enteredQaAnswers.map((a) => {
    const ts = a.recording?.transcript;
    return {
      questionId: a.question.id,
      recordingId: a.recordingId,
      transcriptStatus: ts?.status ?? "MISSING",
      updatedAt: ts?.updatedAt?.toISOString() ?? null,
      completedAt: ts?.completedAt?.toISOString() ?? null,
    };
  });

  // 状态计数
  const qaPendingCount = qaTranscriptItems.filter(
    (t) => t.transcriptStatus === "PENDING",
  ).length;
  const qaProcessingCount = qaTranscriptItems.filter(
    (t) => t.transcriptStatus === "PROCESSING",
  ).length;
  const qaCompletedCount = qaTranscriptItems.filter(
    (t) => t.transcriptStatus === "COMPLETED",
  ).length;
  const qaFailedCount = qaTranscriptItems.filter(
    (t) => t.transcriptStatus === "FAILED",
  ).length;
  const qaMissingCount = qaTranscriptItems.filter(
    (t) => t.transcriptStatus === "MISSING",
  ).length;
  const qaAnsweredWithoutRecordingCount = qaTranscriptItems.filter(
    (t) => !t.recordingId,
  ).length;
  const qaTotalCount = qaTranscriptItems.length;
  const enteredQuestionIds = new Set(
    enteredQaAnswers.map((answer) => answer.questionId),
  );
  const baseQuestions = qaQuestions.filter(
    (question) =>
      question.source !== "DYNAMIC_FOLLOWUP" &&
      question.questionType !== "FOLLOWUP",
  );
  const qaUnansweredBaseQuestionCount = baseQuestions.filter(
    (question) => !enteredQuestionIds.has(question.id),
  ).length;
  const hasQaEnded = ["QA_ENDED", "REPORT_READY", "FINISHED"].includes(
    session.status,
  );

  // 只等待实际进入过的题。未进入的基础题不阻塞报告生成。
  const allQaCompleteOrFailed =
    hasQaEnded &&
    qaPendingCount === 0 &&
    qaProcessingCount === 0;
  const noAnalyzableAnswerContent =
    enteredQaAnswers.length === 0 ||
    enteredQaAnswers.every((answer) => {
      const answerText = answer.answerText?.trim() ?? "";
      const transcriptText = answer.recording?.transcript?.text?.trim() ?? "";
      return !answerText && !transcriptText;
    });

  // 判断是否可以生成 analysis
  // 条件：Pitch transcript 不是 PENDING/PROCESSING，且 QA transcript 全部完成/失败
  const pitchReady =
    !pitchTranscript ||
    pitchTranscript.status === "COMPLETED" ||
    pitchTranscript.status === "FAILED";
  const canGenerateAnalysis = pitchReady && allQaCompleteOrFailed;

  // 判断是否有 stale analysis
  let hasStaleAnalysis = false;
  if (
    analysis &&
    analysis.status === "COMPLETED" &&
    analysis.updatedAt
  ) {
    const analysisUpdatedMs = analysis.updatedAt.getTime();
    const allTranscriptTimes = [
      ...(pitchTranscript?.completedAt
        ? [pitchTranscript.completedAt.getTime()]
        : []),
      ...qaTranscriptItems
        .filter((t) => t.completedAt)
        .map((t) => new Date(t.completedAt!).getTime()),
    ];

    if (allTranscriptTimes.length > 0) {
      const latestTranscriptMs = Math.max(...allTranscriptTimes);
      if (latestTranscriptMs > analysisUpdatedMs) {
        hasStaleAnalysis = true;
      }
    }
  }

  return NextResponse.json({
    analysisStatus: analysis?.status ?? "NONE",
    analysisId: analysis?.id ?? null,
    analysisError: analysis?.errorMessage ?? null,
    pitchTranscriptStatus: pitchTranscript?.status ?? "MISSING",
    qaTranscriptPendingCount: qaPendingCount,
    qaTranscriptProcessingCount: qaProcessingCount,
    qaTranscriptCompletedCount: qaCompletedCount,
    qaTranscriptFailedCount: qaFailedCount,
    qaTranscriptMissingCount: qaMissingCount,
    qaAnsweredWithoutRecordingCount,
    qaUnansweredBaseQuestionCount,
    enteredQaQuestionCount: enteredQaAnswers.length,
    noAnalyzableAnswerContent,
    qaTotalCount,
    canGenerateAnalysis,
    hasStaleAnalysis,
    qaTranscriptItems,
  });
}
