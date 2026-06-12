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

  // 获取 QA transcript 状态计数
  const qaTranscripts = await prisma.trainingTranscript.findMany({
    where: {
      sessionId,
      recording: { phase: "QA" },
    },
    select: {
      id: true,
      status: true,
      completedAt: true,
      updatedAt: true,
    },
  });

  // 获取 QA questions 总数（有 recording 的才需要转写）
  const qaQuestionsWithRecording = await prisma.trainingQuestion.count({
    where: {
      sessionId,
      answer: {
        recordingId: { not: null },
      },
    },
  });

  const qaPendingCount = qaTranscripts.filter(
    (t) => t.status === "PENDING",
  ).length;
  const qaProcessingCount = qaTranscripts.filter(
    (t) => t.status === "PROCESSING",
  ).length;
  const qaCompletedCount = qaTranscripts.filter(
    (t) => t.status === "COMPLETED",
  ).length;
  const qaFailedCount = qaTranscripts.filter(
    (t) => t.status === "FAILED",
  ).length;
  const qaMissingCount = qaQuestionsWithRecording - qaTranscripts.length;

  const qaTotalCount = qaQuestionsWithRecording;

  // 所有 QA transcript 都已完成或失败
  const allQaCompleteOrFailed =
    qaTotalCount > 0 &&
    qaPendingCount === 0 &&
    qaProcessingCount === 0 &&
    qaMissingCount === 0;

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
      ...qaTranscripts
        .filter((t) => t.completedAt)
        .map((t) => t.completedAt!.getTime()),
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
    qaTotalCount,
    canGenerateAnalysis,
    hasStaleAnalysis,
  });
}