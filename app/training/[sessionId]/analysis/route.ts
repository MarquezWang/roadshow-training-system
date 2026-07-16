import { NextRequest, NextResponse } from "next/server";
import {
  buildProjectAIContext,
  parseProjectAIContextSnapshot,
  ProjectContextNotFoundError,
} from "@/lib/project-context";
import { loadPromptTemplate } from "@/lib/prompt-loader";
import { devLog, devError } from "@/lib/dev-log";
import { prisma } from "@/lib/prisma";
import { isSessionOwnedByCurrentUser } from "@/lib/auth-server";
import {
  calculateTrainingAnalysisInputHash,
  reconcileTrainingAnalysisInputVersion,
} from "@/lib/training-analysis-input";
import { acquireAsyncJob, releaseAsyncJob } from "@/lib/async-job";
import {
  isFallbackTrainingAnalysis,
} from "@/lib/training-analysis-fallback";
import { publishTrainingAnalysis } from "@/lib/training-analysis-publication.mjs";
import { getTrainingAnalysisGenerationContract } from "@/lib/training-analysis-version.mjs";
import {
  type TrainingAnalysisResult,
  type QaReview,
  type DynamicFollowupReview,
} from "@/lib/training-analysis-validator";
import {
  buildFallbackTrainingAnalysis,
  type TrainingAnalysisQuestionData as AnalysisQuestionData,
} from "@/lib/training-analysis-fallback-builder";
import {
  buildStoredTrainingAnalysisResult,
  buildTrainingAnalysisPrompt,
  generateTrainingAnalysisFromAI,
} from "@/lib/training-analysis-ai";

type TrainingAnalysisRouteContext = Readonly<{
  params: Promise<{
    sessionId: string;
  }>;
}>;

type TrainingAnalysisRecord = NonNullable<
  Awaited<ReturnType<typeof findLatestAnalysis>>
>;

const PITCH_ANALYSIS_TYPE = "PITCH";
const ANALYSIS_GENERATION_CONTRACT = getTrainingAnalysisGenerationContract();
const PROCESSING_ANALYSIS_TIMEOUT_MS = 5 * 60 * 1_000;
const TRANSCRIPT_WAIT_TIMEOUT_MS = 90_000;
const analysisJobKey = (sessionId: string) => `training-analysis:${sessionId}`;

function parseStoredJson<T>(value: string, fallback: T): T {
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

function serializeAnalysis(analysis: TrainingAnalysisRecord) {
  const rawResult = parseStoredJson<Record<string, unknown>>(
    analysis.rawResultJson,
    {},
  );

  return {
    id: analysis.id,
    sessionId: analysis.sessionId,
    projectId: analysis.projectId,
    transcriptId: analysis.transcriptId,
    status: analysis.status,
    analysisType: analysis.analysisType,
    durationSec: analysis.durationSec,
    pageCount: analysis.pageCount,
    slideEventCount: analysis.slideEventCount,
    overallScore: analysis.overallScore,
    isFallbackReport: isFallbackTrainingAnalysis(analysis),
    fallbackReason: analysis.fallbackReason,
    summary: analysis.summary,
    strengths: parseStoredJson<string[]>(analysis.strengthsJson, []),
    weaknesses: parseStoredJson<string[]>(analysis.weaknessesJson, []),
    suggestions: parseStoredJson<string[]>(analysis.suggestionsJson, []),
    onePageSummary: rawResult.onePageSummary ?? null,
    diagnostics: rawResult.diagnostics ?? null,
    actionItems: Array.isArray(rawResult.actionItems)
      ? rawResult.actionItems
      : [],
    nextTrainingTasks: Array.isArray(rawResult.nextTrainingTasks)
      ? rawResult.nextTrainingTasks
      : [],
    coverage: parseStoredJson<TrainingAnalysisResult["contentCoverage"]>(
      analysis.coverageJson,
      [],
    ),
    contentCoverage: parseStoredJson<TrainingAnalysisResult["contentCoverage"]>(
      analysis.coverageJson,
      [],
    ),
    timing: parseStoredJson<Record<string, unknown>>(analysis.timingJson, {}),
    slideSync: parseStoredJson<Record<string, unknown>>(
      analysis.slideSyncJson,
      {},
    ),
    riskQuestions: parseStoredJson<string[]>(analysis.riskQuestionsJson, []),
    qaReviews: (Array.isArray(rawResult.qaReviews)
      ? rawResult.qaReviews
      : []) as QaReview[],
    dynamicFollowupReview:
      rawResult.dynamicFollowupReview === null ||
      rawResult.dynamicFollowupReview === undefined
        ? null
        : (rawResult.dynamicFollowupReview as DynamicFollowupReview),
    rawResult,
    errorMessage: analysis.errorMessage,
    inputHash: analysis.inputHash,
    promptVersion: analysis.promptVersion,
    schemaVersion: analysis.schemaVersion,
    modelVersion: analysis.modelVersion,
    ruleVersion: analysis.ruleVersion,
    createdAt: analysis.createdAt.toISOString(),
    updatedAt: analysis.updatedAt.toISOString(),
  };
}

function isProcessingAnalysisFresh(analysis: TrainingAnalysisRecord) {
  return (
    analysis.status === "PROCESSING" &&
    Date.now() - analysis.updatedAt.getTime() < PROCESSING_ANALYSIS_TIMEOUT_MS
  );
}

async function findLatestAnalysis(sessionId: string) {
  return prisma.trainingAnalysis.findFirst({
    where: {
      sessionId,
      analysisType: PITCH_ANALYSIS_TYPE,
    },
    orderBy: {
      createdAt: "desc",
    },
  });
}

function isDynamicFollowupQuestion(question: {
  source?: string | null;
  questionType?: string | null;
}) {
  return (
    question.source === "DYNAMIC_FOLLOWUP" ||
    question.questionType === "FOLLOWUP"
  );
}

function hasEnteredAnswer(answer: {
  startedAt?: Date | null;
  endedAt?: Date | null;
  answerText?: string | null;
  recording?: { id: string } | null;
} | null) {
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

async function findCurrentAnalysis(sessionId: string) {
  const session = await prisma.trainingSession.findUnique({
    where: { id: sessionId },
    select: {
      currentAnalysis: true,
    },
  });

  if (
    session?.currentAnalysis?.status === "COMPLETED" &&
    session.currentAnalysis.analysisType === PITCH_ANALYSIS_TYPE
  ) {
    return session.currentAnalysis;
  }

  return prisma.trainingAnalysis.findFirst({
    where: {
      sessionId,
      analysisType: PITCH_ANALYSIS_TYPE,
      status: "COMPLETED",
    },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
  });
}

function getFriendlyErrorMessage(error: unknown) {
  const message =
    error instanceof Error ? error.message : "路演表现分析生成失败。";

  if (
    message.toLowerCase().includes("timeout") ||
    message.includes("超时") ||
    message.includes("60000ms")
  ) {
    return "路演表现分析生成超时：当前转写文本或项目上下文较长，或模型响应较慢。请提高 AI_TIMEOUT_MS，或减少纳入 AI 分析的材料长度后重试。";
  }

  return message;
}

async function createOrUpdateProcessingAnalysis(input: {
  sessionId: string;
  projectId: string;
  transcriptId: string | null;
  durationSec: number;
  pageCount: number | null;
  slideEventCount: number;
  transcriptMissing: boolean;
  inputHash: string;
}) {
  const baseData = {
    projectId: input.projectId,
    transcriptId: input.transcriptId,
    status: "PROCESSING" as const,
    analysisType: PITCH_ANALYSIS_TYPE,
    durationSec: input.durationSec,
    pageCount: input.pageCount,
    slideEventCount: input.slideEventCount,
    overallScore: null,
    summary: input.transcriptMissing ? "路演自动转写缺失或失败，分析基于项目材料与答辩数据降级生成。" : "",
    strengthsJson: "[]",
    weaknessesJson: "[]",
    suggestionsJson: "[]",
    coverageJson: "[]",
    timingJson: "{}",
    slideSyncJson: "{}",
    riskQuestionsJson: "[]",
    rawResultJson: "{}",
    errorMessage: null,
    isFallback: false,
    fallbackReason: null,
    inputHash: input.inputHash,
    promptVersion: ANALYSIS_GENERATION_CONTRACT.promptVersion,
    schemaVersion: ANALYSIS_GENERATION_CONTRACT.schemaVersion,
    modelVersion: ANALYSIS_GENERATION_CONTRACT.modelVersion,
    ruleVersion: ANALYSIS_GENERATION_CONTRACT.ruleVersion,
  };

  return prisma.trainingAnalysis.create({
    data: {
      ...baseData,
      sessionId: input.sessionId,
    },
  });
}

export async function GET(
  _request: NextRequest,
  context: TrainingAnalysisRouteContext,
) {
  const { sessionId } = await context.params;
  if (!(await isSessionOwnedByCurrentUser(sessionId))) {
    return NextResponse.json({ error: "Session not found" }, { status: 404 });
  }
  const analysis = await findCurrentAnalysis(sessionId);

  // 获取 QA transcript 状态计数，供前端轮询使用
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

  const qaTranscriptStatus = {
    total: qaTranscripts.length,
    pendingCount: qaTranscripts.filter((t) => t.status === "PENDING" || t.status === "PROCESSING").length,
    completedCount: qaTranscripts.filter((t) => t.status === "COMPLETED").length,
    failedCount: qaTranscripts.filter((t) => t.status === "FAILED").length,
    canGenerate: qaTranscripts.length > 0 && qaTranscripts.every((t) => t.status === "COMPLETED" || t.status === "FAILED"),
  };

  return NextResponse.json({
    analysis: analysis ? serializeAnalysis(analysis) : null,
    qaTranscriptStatus,
  });
}

export async function POST(
  request: NextRequest,
  context: TrainingAnalysisRouteContext,
) {
  const { sessionId } = await context.params;
  const forceRegeneration = request.nextUrl.searchParams.get("force") === "true";
  if (!(await isSessionOwnedByCurrentUser(sessionId))) {
    return NextResponse.json({ error: "Session not found" }, { status: 404 });
  }

  let processingAnalysisId: string | null = null;
  let hasGenerationLock = false;
  let analysisJobOwnerToken: string | null = null;
  let analysisJobError: string | null = null;

  try {
    const session = await prisma.trainingSession.findUnique({
      where: {
        id: sessionId,
      },
      include: {
        slideEvents: {
          orderBy: {
            createdAt: "asc",
          },
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
            text: {
              not: "",
            },
            recording: {
              phase: "PITCH",
            },
          },
          orderBy: {
            updatedAt: "desc",
          },
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
          orderBy: {
            orderIndex: "asc",
          },
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

    if (!session) {
      return NextResponse.json({ error: "训练场次不存在。" }, { status: 404 });
    }
    const analysisInputHash = await calculateTrainingAnalysisInputHash(sessionId);
    if (!analysisInputHash) {
      return NextResponse.json({ error: "训练场次不存在。" }, { status: 404 });
    }

    const acquiredAnalysisJob = await acquireAsyncJob({
      jobKey: analysisJobKey(sessionId),
      jobType: "TRAINING_ANALYSIS",
      resourceId: sessionId,
      leaseMs: 15 * 60_000,
    });
    if (!acquiredAnalysisJob) {
      const activeAnalysis = await findLatestAnalysis(sessionId);

      if (activeAnalysis && isProcessingAnalysisFresh(activeAnalysis)) {
        return NextResponse.json({
          analysis: serializeAnalysis(activeAnalysis),
        });
      }

      return NextResponse.json(
        {
          error: "路演表现分析正在生成中，请稍后再试。",
          reason: "analysis_generation_in_progress",
          analysisProcessing: true,
        },
        { status: 409 },
      );
    }

    analysisJobOwnerToken = acquiredAnalysisJob.ownerToken;
    hasGenerationLock = true;

    // 防止重复生成：检查是否已有处理中或已完成的 analysis
    const existingAnalysis = await findLatestAnalysis(sessionId);
    if (existingAnalysis) {
      if (existingAnalysis.status === "PROCESSING") {
        if (isProcessingAnalysisFresh(existingAnalysis)) {
          return NextResponse.json({
            analysis: serializeAnalysis(existingAnalysis),
          });
        }

        devLog("[analysis:POST] stale processing analysis detected, taking over", {
          sessionId,
          analysisId: existingAnalysis.id,
          processingAgeMs: Date.now() - existingAnalysis.updatedAt.getTime(),
          timeoutMs: PROCESSING_ANALYSIS_TIMEOUT_MS,
        });
      }
      if (existingAnalysis.status === "COMPLETED") {
        const staleCheck = await reconcileTrainingAnalysisInputVersion(
          sessionId,
          existingAnalysis,
        );
        if (!staleCheck.stale && !forceRegeneration) {
          return NextResponse.json({
            analysis: {
              ...serializeAnalysis(existingAnalysis),
              inputHash:
                staleCheck.currentInputHash ?? existingAnalysis.inputHash,
            },
          });
        }
        // stale 或用户明确要求重试降级报告时，创建新版本并保留旧报告。
        devLog("[analysis:POST] regenerating completed analysis", {
          sessionId,
          forceRegeneration,
          staleReason: staleCheck.reason,
          analysisUpdatedAt: existingAnalysis.updatedAt.toISOString(),
        });
        // 继续执行，不 return
      }
    }

    if (
      !["PITCH_ENDED", "QA_READY", "QA_ENDED", "REPORT_READY", "FINISHED"].includes(
        session.status,
      ) ||
      !session.pitchEndedAt
    ) {
      return NextResponse.json(
        { error: "请先结束路演后再分析。" },
        { status: 400 },
      );
    }

    const transcript = session.transcripts[0] ?? null;
    const transcriptMissing = !transcript?.text.trim();
    const nowMs = Date.now();

    // 如果 Pitch 转写仍在进行中，未超时前返回等待；超时后继续降级生成。
    if (transcriptMissing) {
      const pitchRecording = await prisma.trainingRecording.findFirst({
        where: {
          sessionId,
          phase: "PITCH",
        },
        orderBy: {
          createdAt: "desc",
        },
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
            ["PENDING", "PROCESSING"].includes(
              pitchRecording.transcript.status,
            )),
      );

      if (pitchTranscriptWaiting && !pitchCanDegrade) {
        return NextResponse.json(
          {
            error: "路演转写正在进行中，请稍后再试。",
            transcriptProcessing: true,
            transcriptStatus: pitchRecording?.transcript?.status ?? "MISSING",
          },
          { status: 409 },
        );
      }
    }

    // 检查 QA 转写状态：有 PENDING/PROCESSING 的 QA 转录时，返回等待状态
    // 等待计时从 qaEndedAt 开始，或从最后一条 QA 录音的结束时间开始
    const qaEndedTime = session.qaEndedAt?.getTime();
    // 如果 qaEndedAt 不存在（例如 QA 未结束），使用最后一条 QA 录音的时间
    const latestQaAnswerTime = session.trainingQuestions
      .filter((q) => hasEnteredAnswer(q.answer) && q.answer?.endedAt)
      .map((q) => q.answer!.endedAt!.getTime())
      .sort((a, b) => b - a)[0];
    const qaBaselineTime = qaEndedTime ?? latestQaAnswerTime;

    // 只有在有明确基线时间且已等待超过 90 秒，才允许降级生成
    const canDegrade = qaBaselineTime
      ? nowMs - qaBaselineTime > TRANSCRIPT_WAIT_TIMEOUT_MS
      : false;
    const enteredQaRecordingIds = session.trainingQuestions
      .filter((q) => hasEnteredAnswer(q.answer) && q.answer?.recording?.id)
      .map((q) => q.answer!.recording!.id);

    if (!canDegrade && enteredQaRecordingIds.length > 0) {
      const pendingQaRecordings = await prisma.trainingRecording.findMany({
        where: {
          sessionId,
          id: {
            in: enteredQaRecordingIds,
          },
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
        return NextResponse.json(
          {
            error: "答辩回答转写尚未完成，请稍后重试。",
            qaTranscriptsProcessing: true,
            pendingCount,
          },
          { status: 409 },
        );
      }
    }

    const durationSec =
      session.pitchDurationSec ??
      Math.max(
        0,
        Math.round(
          (session.pitchEndedAt.getTime() -
            (session.pitchStartedAt?.getTime() ?? session.pitchEndedAt.getTime())) /
            1000,
        ),
      );
    const pageIndexes = session.slideEvents
      .map((event) => event.pageIndex)
      .filter((pageIndex): pageIndex is number => pageIndex !== null);
    const pageCount =
      pageIndexes.length > 0 ? new Set(pageIndexes).size : null;
    const processingAnalysis = await createOrUpdateProcessingAnalysis({
      sessionId: session.id,
      projectId: session.projectId,
      transcriptId: transcript?.id ?? null,
      durationSec,
      pageCount,
      slideEventCount: session.slideEvents.length,
      transcriptMissing,
      inputHash: analysisInputHash,
    });

    processingAnalysisId = processingAnalysis.id;

    const enteredQuestions = session.trainingQuestions.filter((q) =>
      hasEnteredAnswer(q.answer),
    );
    const baseEnteredQuestions = enteredQuestions.filter(
      (q) => !isDynamicFollowupQuestion(q),
    );
    const dynamicFollowupQuestion =
      enteredQuestions.find((q) => isDynamicFollowupQuestion(q)) ?? null;

    const mapQuestionToAnalysisData = (
      q: (typeof enteredQuestions)[number],
    ): AnalysisQuestionData => {
      const transcribeStatus = q.answer?.recording?.transcript?.status ?? null;
      const transcribeText = q.answer?.recording?.transcript?.text ?? null;
      const isPendingOrProcessing =
        transcribeStatus === "PENDING" || transcribeStatus === "PROCESSING";
      return {
        questionId: q.id,
        orderIndex: q.orderIndex,
        questionType: q.questionType,
        source: q.source,
        questionText: q.questionText,
        answerDurationSec: q.answer?.durationSec ?? null,
        answerText: q.answer?.answerText ?? null,
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
    };

    const qaData = baseEnteredQuestions.map(mapQuestionToAnalysisData);
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

    if (!hasAnalyzableText) {
      const fallbackAnalysis = buildFallbackTrainingAnalysis({
        durationSec,
        pageCount,
        slideEventCount: session.slideEvents.length,
        transcriptMissing,
        qaData,
        dynamicFollowupData,
        failureReason: "NO_ANALYZABLE_TEXT",
      });
      const latestInputHash = await calculateTrainingAnalysisInputHash(sessionId);
      if (!latestInputHash || latestInputHash !== analysisInputHash) {
        await prisma.trainingAnalysis.update({
          where: { id: processingAnalysis.id },
          data: {
            status: "FAILED",
            errorMessage: "报告生成期间训练输入发生变化，请重新生成。",
          },
        });
        processingAnalysisId = null;
        analysisJobError = "analysis input changed while generating";
        return NextResponse.json(
          {
            error: "报告生成期间训练输入发生变化，请重新生成。",
            reason: "analysis_input_changed",
          },
          { status: 409 },
        );
      }

      const completedAnalysis = await publishTrainingAnalysis(prisma, {
        jobKey: analysisJobKey(sessionId),
        ownerToken: analysisJobOwnerToken,
        sessionId,
        analysisId: processingAnalysis.id,
        inputHash: analysisInputHash,
        data: {
          overallScore: fallbackAnalysis.overallScore,
          summary:
            "本轮路演与答辩转写文本不可用，系统已生成降级报告。答辩回答内容无法基于文本完整评分，请结合录音回放人工复核。",
          strengthsJson: JSON.stringify(fallbackAnalysis.strengths, null, 2),
          weaknessesJson: JSON.stringify(fallbackAnalysis.weaknesses, null, 2),
          suggestionsJson: JSON.stringify(fallbackAnalysis.suggestions, null, 2),
          coverageJson: JSON.stringify(
            fallbackAnalysis.contentCoverage,
            null,
            2,
          ),
          timingJson: JSON.stringify(fallbackAnalysis.timing, null, 2),
          slideSyncJson: JSON.stringify(fallbackAnalysis.slideSync, null, 2),
          riskQuestionsJson: JSON.stringify(
            fallbackAnalysis.riskQuestions,
            null,
            2,
          ),
          rawResultJson: JSON.stringify(fallbackAnalysis, null, 2),
          errorMessage: null,
          isFallback: true,
          fallbackReason: "NO_ANALYZABLE_TEXT",
        },
      });
      processingAnalysisId = null;

      return NextResponse.json({
        analysis: serializeAnalysis(completedAnalysis),
      });
    }

    const snapshotContext = parseProjectAIContextSnapshot(
      session.projectContextSnapshot,
    );
    const [contextResult, template] = await Promise.all([
      snapshotContext ?? buildProjectAIContext(session.projectId),
      loadPromptTemplate("pitch-performance-analysis"),
    ]);
    const userPrompt = buildTrainingAnalysisPrompt(contextResult, template, {
      session: {
        id: session.id,
        status: session.status,
        pitchStartedAt: session.pitchStartedAt?.toISOString() ?? null,
        pitchEndedAt: session.pitchEndedAt?.toISOString() ?? null,
        pitchDurationSec: durationSec,
        currentPageIndex: session.currentPageIndex,
      },
      slideEvents: session.slideEvents.map((event) => ({
        eventType: event.eventType,
        pageIndex: event.pageIndex,
        elapsedSec: event.elapsedSec,
        createdAt: event.createdAt.toISOString(),
      })),
      transcript: transcript
        ? {
            id: transcript.id,
            source: transcript.source,
            language: transcript.language,
            completedAt: transcript.completedAt?.toISOString() ?? null,
            text: transcript.text,
          }
        : {
            id: null,
            source: "NONE",
            language: "zh-CN",
            completedAt: null,
            text: transcriptMissing
              ? "【路演转写缺失】路演录音转写失败或超时，分析将基于项目材料、答辩数据及录音元信息降级进行。"
              : "",
      },
      qaData,
      dynamicFollowupData,
    });
    const generation = await generateTrainingAnalysisFromAI({
      sessionId,
      userPrompt,
      durationSec,
      pageCount,
      slideEventCount: session.slideEvents.length,
      transcriptMissing,
      qaData,
      dynamicFollowupData,
    });
    const analysisJson = generation.analysis;
    const analysisParseFailureDebug = generation.debug;
    const analysisFallbackReason = generation.fallbackReason;

    // 空回答/无效回答容错：确保每个 QA 问题都有合理的 qaReview
    const noAnswerQuestionIds = new Set(
      qaData
        .filter((q) => {
          if (q.answerDurationSec === null) return true;
          if (q.answerDurationSec < 2) return true;
          if (q.transcribeStatus === "FAILED") return true;
          if (
            q.transcribeStatus === "COMPLETED" &&
            !q.transcribeText?.trim()
          )
            return true;
          return false;
        })
        .map((q) => q.questionId),
    );

    // PENDING/PROCESSING 转写：不是"未作答"，是"转写未完成"
    const pendingTranscribeQuestionIds = new Set(
      qaData
        .filter((q) => q.transcribePending)
        .map((q) => q.questionId),
    );

    const existingQaReviews: QaReview[] = analysisJson.qaReviews ?? [];
    const reviewedQuestionIds = new Set(
      existingQaReviews.map((r) => r.questionId),
    );

    const missingReviews: QaReview[] = qaData
      .filter((q) => !reviewedQuestionIds.has(q.questionId))
      .map((q) => {
        const isNoAnswer = noAnswerQuestionIds.has(q.questionId);
        const isPending = pendingTranscribeQuestionIds.has(q.questionId);
        return {
          questionId: q.questionId,
          questionIndex: q.orderIndex,
          dimension: "OTHER" as const,
          question: q.questionText,
          judgeIntent: "评委意图暂未明确记录。",
          answerSummary: isPending
            ? "转写尚未完成，分析依据不足。"
            : isNoAnswer
              ? "未检测到有效回答，或当前转写文本不足以判断回答内容。"
              : "回答摘要暂时无法提供。",
          responseQuality: "WEAK" as const,
          responseQualityLabel: isPending
            ? "转写超时，分析依据不足"
            : "回答缺失或偏弱",
          missingPoints: isNoAnswer
            ? ["未正面回应评委问题", "未提供数据、案例或材料依据"]
            : [],
          evidenceUse: "未能提供有效证据。",
          improvementAdvice:
            "建议围绕评委问题正面作答，并补充关键数据、案例或验证依据。",
          betterAnswerOutline: [
            `针对"${q.questionText}"，建议先明确回答核心问题`,
            "结合项目材料补充关键数据或案例",
            "总结回答要点，呼应评委关注点",
          ],
        };
      });

    // 对已有但回答无效的 qaReview，确保其 quality 为 WEAK
    const normalizedQaReviews: QaReview[] = existingQaReviews.map((review) => {
      if (noAnswerQuestionIds.has(review.questionId)) {
        return {
          ...review,
          responseQuality: "WEAK" as const,
          responseQualityLabel: "回答缺失或偏弱",
          answerSummary:
            review.answerSummary ||
            "未检测到有效回答，或当前转写文本不足以判断回答内容。",
          evidenceUse: review.evidenceUse || "未能提供有效证据。",
          missingPoints: review.missingPoints?.length
            ? review.missingPoints
            : ["未正面回应评委问题", "未提供数据、案例或材料依据"],
          improvementAdvice:
            review.improvementAdvice ||
            "建议围绕评委问题正面作答，并补充关键数据、案例或验证依据。",
          betterAnswerOutline: review.betterAnswerOutline?.length
            ? review.betterAnswerOutline
            : [
                `针对"${review.question}"，建议先明确回答核心问题`,
                "结合项目材料补充关键数据或案例",
                "总结回答要点，呼应评委关注点",
              ],
        };
      }
      if (pendingTranscribeQuestionIds.has(review.questionId)) {
        return {
          ...review,
          responseQuality: "WEAK" as const,
          responseQualityLabel: "转写超时，分析依据不足",
          answerSummary:
            review.answerSummary || "转写尚未完成，分析依据不足。",
          evidenceUse: review.evidenceUse || "未能提供有效证据。",
          missingPoints: review.missingPoints?.length
            ? review.missingPoints
            : ["转写未完成，无法评估回答内容"],
          improvementAdvice:
            review.improvementAdvice ||
            "转写完成后可重新生成分析以获得更准确的评估。",
          betterAnswerOutline: review.betterAnswerOutline?.length
            ? review.betterAnswerOutline
            : [
                `针对"${review.question}"，建议先明确回答核心问题`,
                "结合项目材料补充关键数据或案例",
                "总结回答要点，呼应评委关注点",
              ],
        };
      }
      return review;
    });

    analysisJson.qaReviews = [...normalizedQaReviews, ...missingReviews];

    const latestInputHash = await calculateTrainingAnalysisInputHash(sessionId);
    if (!latestInputHash || latestInputHash !== analysisInputHash) {
      await prisma.trainingAnalysis.update({
        where: { id: processingAnalysis.id },
        data: {
          status: "FAILED",
          errorMessage: "报告生成期间训练输入发生变化，请重新生成。",
        },
      });
      processingAnalysisId = null;
      analysisJobError = "analysis input changed while generating";
      return NextResponse.json(
        {
          error: "报告生成期间训练输入发生变化，请重新生成。",
          reason: "analysis_input_changed",
        },
        { status: 409 },
      );
    }

    const completedAnalysis = await publishTrainingAnalysis(prisma, {
      jobKey: analysisJobKey(sessionId),
      ownerToken: analysisJobOwnerToken,
      sessionId,
      analysisId: processingAnalysis.id,
      inputHash: analysisInputHash,
      data: {
        overallScore: analysisJson.overallScore,
        summary: analysisJson.summary,
        strengthsJson: JSON.stringify(analysisJson.strengths, null, 2),
        weaknessesJson: JSON.stringify(analysisJson.weaknesses, null, 2),
        suggestionsJson: JSON.stringify(analysisJson.suggestions, null, 2),
        coverageJson: JSON.stringify(analysisJson.contentCoverage, null, 2),
        timingJson: JSON.stringify(analysisJson.timing, null, 2),
        slideSyncJson: JSON.stringify(analysisJson.slideSync, null, 2),
        riskQuestionsJson: JSON.stringify(
          analysisJson.riskQuestions,
          null,
          2,
        ),
        rawResultJson: buildStoredTrainingAnalysisResult(
          analysisJson,
          analysisParseFailureDebug,
        ),
        errorMessage: analysisParseFailureDebug
          ? analysisParseFailureDebug.reason === "AI_EMPTY_CONTENT"
            ? "AI 返回内容为空，已生成降级报告。详情见 rawResultJson._debug。"
            : "AI 结构化输出不符合报告 Schema，修复重试失败后已生成降级报告。详情见 rawResultJson._debug。"
          : null,
        isFallback: analysisFallbackReason !== null,
        fallbackReason: analysisFallbackReason,
      },
    });
    processingAnalysisId = null;

    return NextResponse.json({ analysis: serializeAnalysis(completedAnalysis) });
  } catch (error) {
    const message = getFriendlyErrorMessage(error);
    analysisJobError = message;

    if (processingAnalysisId) {
      await prisma.trainingAnalysis.update({
        where: {
          id: processingAnalysisId,
        },
        data: {
          status: "FAILED",
          errorMessage: message,
        },
      });
    }

    if (error instanceof ProjectContextNotFoundError) {
      return NextResponse.json({ error: error.message }, { status: 404 });
    }

    devError("路演表现分析生成失败。", { error: message });

    return NextResponse.json({ error: message }, { status: 500 });
  } finally {
    if (hasGenerationLock) {
      await releaseAsyncJob({
        jobKey: analysisJobKey(sessionId),
        ownerToken: analysisJobOwnerToken,
        status: analysisJobError ? "FAILED" : "COMPLETED",
        errorMessage: analysisJobError,
      });
    }
  }
}
