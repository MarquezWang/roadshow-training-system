import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { isSessionOwnedByCurrentUser } from "@/lib/auth-server";
import { reconcileTrainingAnalysisInputVersion } from "@/lib/training-analysis-input";
import { trainingAnalysisJobKey } from "@/lib/training-analysis-job.mjs";
import { recoverTrainingTranscriptionsForSession } from "@/lib/training-transcribe-task";

export const dynamic = "force-dynamic";

type ReportStatusContext = Readonly<{
  params: Promise<{
    sessionId: string;
  }>;
}>;

const TRANSCRIPT_WAIT_TIMEOUT_MS = 90_000;
const PROCESSING_ANALYSIS_TIMEOUT_MS = 5 * 60 * 1_000;

function isWaitingTranscriptStatus(status: string | null | undefined) {
  return status === "PENDING" || status === "PROCESSING";
}

function hasWaitTimedOut(startedAt: Date | null | undefined, nowMs: number) {
  return startedAt
    ? nowMs - startedAt.getTime() > TRANSCRIPT_WAIT_TIMEOUT_MS
    : false;
}

export async function GET(
  _request: NextRequest,
  context: ReportStatusContext,
) {
  const { sessionId } = await context.params;
  if (!(await isSessionOwnedByCurrentUser(sessionId))) {
    return NextResponse.json({ error: "Session not found" }, { status: 404 });
  }

  const session = await prisma.trainingSession.findUnique({
    where: { id: sessionId },
    select: {
      id: true,
      status: true,
      pitchEndedAt: true,
      qaEndedAt: true,
      currentAnalysisId: true,
      currentAnalysis: {
        select: {
          id: true,
          status: true,
          analysisType: true,
          errorMessage: true,
          updatedAt: true,
          inputHash: true,
        },
      },
    },
  });

  if (!session) {
    return NextResponse.json({ error: "训练场次不存在。" }, { status: 404 });
  }

  // 读报告状态时同步修复历史缺失任务和租约过期任务；真正的 ASR 在后台执行。
  await recoverTrainingTranscriptionsForSession(sessionId);

  // 最新尝试用于显示生成进度；当前指针用于持续展示最后一个成功版本。
  const latestAnalysisAttempt = await prisma.trainingAnalysis.findFirst({
    where: {
      sessionId,
      analysisType: "PITCH",
    },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      status: true,
      errorMessage: true,
      updatedAt: true,
      inputHash: true,
    },
  });
  const analysisJob = await prisma.asyncJob.findUnique({
    where: { jobKey: trainingAnalysisJobKey(sessionId) },
    select: {
      status: true,
      leaseExpiresAt: true,
      nextAttemptAt: true,
      errorMessage: true,
    },
  });
  const pointedAnalysis =
    session.currentAnalysis?.status === "COMPLETED" &&
    session.currentAnalysis.analysisType === "PITCH"
      ? session.currentAnalysis
      : null;
  const currentAnalysis =
    pointedAnalysis ??
    (await prisma.trainingAnalysis.findFirst({
      where: {
        sessionId,
        analysisType: "PITCH",
        status: "COMPLETED",
      },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      select: {
        id: true,
        status: true,
        analysisType: true,
        errorMessage: true,
        updatedAt: true,
        inputHash: true,
      },
    }));
  const analysis = latestAnalysisAttempt ?? currentAnalysis;

  // 从录音侧读取转写，确保“已有录音但 Transcript 尚未创建”不会被视为完成。
  const pitchRecording = await prisma.trainingRecording.findFirst({
    where: {
      sessionId,
      phase: "PITCH",
    },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      createdAt: true,
      updatedAt: true,
      transcript: {
        select: {
          id: true,
          status: true,
          completedAt: true,
          updatedAt: true,
        },
      },
    },
  });
  const pitchTranscript = pitchRecording?.transcript ?? null;

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
  const qaMissingWithRecordingCount = qaTranscriptItems.filter(
    (t) => t.recordingId && t.transcriptStatus === "MISSING",
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
  const nowMs = Date.now();
  const qaTranscriptWaitTimedOut =
    hasQaEnded && hasWaitTimedOut(session.qaEndedAt, nowMs);
  const pitchTranscriptWaiting = isWaitingTranscriptStatus(
    pitchTranscript?.status,
  ) || Boolean(pitchRecording && !pitchTranscript);
  const pitchTranscriptWaitTimedOut =
    pitchTranscriptWaiting &&
    hasWaitTimedOut(
      pitchTranscript?.updatedAt ??
        pitchRecording?.updatedAt ??
        pitchRecording?.createdAt ??
        session.pitchEndedAt ??
        session.qaEndedAt,
      nowMs,
    );

  // 只等待实际进入过的题。未进入的基础题不阻塞报告生成。
  const allQaCompleteOrFailed =
    hasQaEnded &&
    ((qaPendingCount === 0 &&
      qaProcessingCount === 0 &&
      qaMissingWithRecordingCount === 0) ||
      qaTranscriptWaitTimedOut);
  const noAnalyzableAnswerContent =
    enteredQaAnswers.length === 0 ||
    enteredQaAnswers.every((answer) => {
      const answerText = answer.answerText?.trim() ?? "";
      const transcriptText = answer.recording?.transcript?.text?.trim() ?? "";
      return !answerText && !transcriptText;
    });

  // 判断是否可以生成 analysis
  // 条件：Pitch/QA transcript 已稳定，或等待超过阈值后允许降级生成。
  const pitchReady =
    !pitchRecording ||
    pitchTranscript?.status === "COMPLETED" ||
    pitchTranscript?.status === "FAILED" ||
    pitchTranscriptWaitTimedOut;
  const canGenerateAnalysis = pitchReady && allQaCompleteOrFailed;

  // 旧报告在确认输入未变化后会自动补写内容指纹，不要求用户无意义地重生成。
  const analysisVersion = currentAnalysis
    ? await reconcileTrainingAnalysisInputVersion(sessionId, currentAnalysis)
    : null;
  const hasStaleAnalysis = analysisVersion?.stale ?? false;
  const analysisProcessingTimedOut =
    analysis?.status === "PROCESSING" &&
    analysis.updatedAt !== null &&
    nowMs - analysis.updatedAt.getTime() > PROCESSING_ANALYSIS_TIMEOUT_MS;
  const analysisJobActive = Boolean(
    analysisJob?.status === "PENDING" ||
      analysisJob?.status === "RETRY_WAIT" ||
      (analysisJob?.status === "RUNNING" &&
        analysisJob.leaseExpiresAt &&
        analysisJob.leaseExpiresAt.getTime() > nowMs),
  );
  return NextResponse.json({
    analysisStatus: analysis?.status ?? "NONE",
    analysisId: analysis?.id ?? null,
    analysisError: analysis?.errorMessage ?? null,
    analysisJobStatus: analysisJob?.status ?? "NONE",
    analysisJobError: analysisJob?.errorMessage ?? null,
    analysisJobActive,
    currentAnalysisId: currentAnalysis?.id ?? null,
    hasCurrentAnalysis: Boolean(currentAnalysis),
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
    analysisProcessingTimedOut,
    qaTranscriptItems,
  });
}
