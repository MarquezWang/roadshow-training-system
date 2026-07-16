import { NextRequest, NextResponse } from "next/server";
import {
  buildProjectAIContext,
  parseProjectAIContextSnapshot,
  ProjectContextNotFoundError,
} from "@/lib/project-context";
import { loadPromptTemplate } from "@/lib/prompt-loader";
import { devError, devLog } from "@/lib/dev-log";
import { isSessionOwnedByCurrentUser } from "@/lib/auth-server";
import {
  calculateTrainingAnalysisInputHash,
  reconcileTrainingAnalysisInputVersion,
} from "@/lib/training-analysis-input";
import { acquireAsyncJob, releaseAsyncJob } from "@/lib/async-job";
import {
  buildTrainingAnalysisPrompt,
  generateTrainingAnalysisFromAI,
} from "@/lib/training-analysis-ai";
import { normalizeTrainingAnalysisQaReviews } from "@/lib/training-analysis-qa-reviews";
import {
  buildTrainingAnalysisPromptInput,
  canGenerateTrainingAnalysis,
  findTrainingAnalysisSession,
  getTrainingAnalysisTranscriptWaitState,
  prepareTrainingAnalysisInput,
} from "./training-analysis-input";
import {
  hasTrainingAnalysisInputChanged,
  markTrainingAnalysisFailed,
  publishGeneratedTrainingAnalysis,
  publishNoAnalyzableTextTrainingAnalysis,
} from "./training-analysis-persistence";
import {
  createProcessingTrainingAnalysis,
  findCurrentTrainingAnalysis,
  findLatestTrainingAnalysis,
  getQaTranscriptStatus,
  getTrainingAnalysisJobKey,
  isProcessingTrainingAnalysisFresh,
  serializeTrainingAnalysis,
  TRAINING_ANALYSIS_PROCESSING_TIMEOUT_MS,
} from "./training-analysis-records";

type TrainingAnalysisRouteContext = Readonly<{
  params: Promise<{
    sessionId: string;
  }>;
}>;

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

export async function GET(
  _request: NextRequest,
  context: TrainingAnalysisRouteContext,
) {
  const { sessionId } = await context.params;
  if (!(await isSessionOwnedByCurrentUser(sessionId))) {
    return NextResponse.json({ error: "Session not found" }, { status: 404 });
  }

  const [analysis, qaTranscriptStatus] = await Promise.all([
    findCurrentTrainingAnalysis(sessionId),
    getQaTranscriptStatus(sessionId),
  ]);

  return NextResponse.json({
    analysis: analysis ? serializeTrainingAnalysis(analysis) : null,
    qaTranscriptStatus,
  });
}

export async function POST(
  request: NextRequest,
  context: TrainingAnalysisRouteContext,
) {
  const { sessionId } = await context.params;
  const forceRegeneration =
    request.nextUrl.searchParams.get("force") === "true";
  if (!(await isSessionOwnedByCurrentUser(sessionId))) {
    return NextResponse.json({ error: "Session not found" }, { status: 404 });
  }

  let processingAnalysisId: string | null = null;
  let hasGenerationLock = false;
  let analysisJobOwnerToken: string | null = null;
  let analysisJobError: string | null = null;

  try {
    const session = await findTrainingAnalysisSession(sessionId);

    if (!session) {
      return NextResponse.json({ error: "训练场次不存在。" }, { status: 404 });
    }
    const analysisInputHash =
      await calculateTrainingAnalysisInputHash(sessionId);
    if (!analysisInputHash) {
      return NextResponse.json({ error: "训练场次不存在。" }, { status: 404 });
    }

    const acquiredAnalysisJob = await acquireAsyncJob({
      jobKey: getTrainingAnalysisJobKey(sessionId),
      jobType: "TRAINING_ANALYSIS",
      resourceId: sessionId,
      leaseMs: 15 * 60_000,
    });
    if (!acquiredAnalysisJob) {
      const activeAnalysis = await findLatestTrainingAnalysis(sessionId);

      if (activeAnalysis && isProcessingTrainingAnalysisFresh(activeAnalysis)) {
        return NextResponse.json({
          analysis: serializeTrainingAnalysis(activeAnalysis),
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
    const existingAnalysis = await findLatestTrainingAnalysis(sessionId);
    if (existingAnalysis) {
      if (existingAnalysis.status === "PROCESSING") {
        if (isProcessingTrainingAnalysisFresh(existingAnalysis)) {
          return NextResponse.json({
            analysis: serializeTrainingAnalysis(existingAnalysis),
          });
        }

        devLog(
          "[analysis:POST] stale processing analysis detected, taking over",
          {
            sessionId,
            analysisId: existingAnalysis.id,
            processingAgeMs: Date.now() - existingAnalysis.updatedAt.getTime(),
            timeoutMs: TRAINING_ANALYSIS_PROCESSING_TIMEOUT_MS,
          },
        );
      }
      if (existingAnalysis.status === "COMPLETED") {
        const staleCheck = await reconcileTrainingAnalysisInputVersion(
          sessionId,
          existingAnalysis,
        );
        if (!staleCheck.stale && !forceRegeneration) {
          return NextResponse.json({
            analysis: {
              ...serializeTrainingAnalysis(existingAnalysis),
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

    if (!canGenerateTrainingAnalysis(session)) {
      return NextResponse.json(
        { error: "请先结束路演后再分析。" },
        { status: 400 },
      );
    }

    const transcriptWaitState =
      await getTrainingAnalysisTranscriptWaitState(session);
    if (transcriptWaitState.kind === "pitch") {
      return NextResponse.json(
        {
          error: "路演转写正在进行中，请稍后再试。",
          transcriptProcessing: true,
          transcriptStatus: transcriptWaitState.transcriptStatus,
        },
        { status: 409 },
      );
    }
    if (transcriptWaitState.kind === "qa") {
      return NextResponse.json(
        {
          error: "答辩回答转写尚未完成，请稍后重试。",
          qaTranscriptsProcessing: true,
          pendingCount: transcriptWaitState.pendingCount,
        },
        { status: 409 },
      );
    }

    const preparedInput = prepareTrainingAnalysisInput(session);
    const {
      transcript,
      transcriptMissing,
      durationSec,
      pageCount,
      slideEventCount,
      qaData,
      dynamicFollowupData,
      hasAnalyzableText,
    } = preparedInput;
    const processingAnalysis = await createProcessingTrainingAnalysis({
      sessionId: session.id,
      projectId: session.projectId,
      transcriptId: transcript?.id ?? null,
      durationSec,
      pageCount,
      slideEventCount,
      transcriptMissing,
      inputHash: analysisInputHash,
    });

    processingAnalysisId = processingAnalysis.id;

    if (!hasAnalyzableText) {
      if (
        await hasTrainingAnalysisInputChanged({
          sessionId,
          analysisId: processingAnalysis.id,
          expectedInputHash: analysisInputHash,
        })
      ) {
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

      const completedAnalysis = await publishNoAnalyzableTextTrainingAnalysis(
        {
          sessionId,
          ownerToken: analysisJobOwnerToken,
          analysisId: processingAnalysis.id,
          inputHash: analysisInputHash,
        },
        {
          durationSec,
          pageCount,
          slideEventCount,
          transcriptMissing,
          qaData,
          dynamicFollowupData,
        },
      );
      processingAnalysisId = null;

      return NextResponse.json({
        analysis: serializeTrainingAnalysis(completedAnalysis),
      });
    }

    const snapshotContext = parseProjectAIContextSnapshot(
      session.projectContextSnapshot,
    );
    const [contextResult, template] = await Promise.all([
      snapshotContext ?? buildProjectAIContext(session.projectId),
      loadPromptTemplate("pitch-performance-analysis"),
    ]);
    const userPrompt = buildTrainingAnalysisPrompt(
      contextResult,
      template,
      buildTrainingAnalysisPromptInput(session, preparedInput),
    );
    const generation = await generateTrainingAnalysisFromAI({
      sessionId,
      userPrompt,
      durationSec,
      pageCount,
      slideEventCount,
      transcriptMissing,
      qaData,
      dynamicFollowupData,
    });
    const analysisJson = normalizeTrainingAnalysisQaReviews(
      generation.analysis,
      qaData,
    );
    const analysisParseFailureDebug = generation.debug;
    const analysisFallbackReason = generation.fallbackReason;

    if (
      await hasTrainingAnalysisInputChanged({
        sessionId,
        analysisId: processingAnalysis.id,
        expectedInputHash: analysisInputHash,
      })
    ) {
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

    const completedAnalysis = await publishGeneratedTrainingAnalysis(
      {
        sessionId,
        ownerToken: analysisJobOwnerToken,
        analysisId: processingAnalysis.id,
        inputHash: analysisInputHash,
      },
      {
        analysis: analysisJson,
        debug: analysisParseFailureDebug,
        fallbackReason: analysisFallbackReason,
      },
    );
    processingAnalysisId = null;

    return NextResponse.json({
      analysis: serializeTrainingAnalysis(completedAnalysis),
    });
  } catch (error) {
    const message = getFriendlyErrorMessage(error);
    analysisJobError = message;

    if (processingAnalysisId) {
      await markTrainingAnalysisFailed(processingAnalysisId, message);
    }

    if (error instanceof ProjectContextNotFoundError) {
      return NextResponse.json({ error: error.message }, { status: 404 });
    }

    devError("路演表现分析生成失败。", { error: message });

    return NextResponse.json({ error: message }, { status: 500 });
  } finally {
    if (hasGenerationLock) {
      await releaseAsyncJob({
        jobKey: getTrainingAnalysisJobKey(sessionId),
        ownerToken: analysisJobOwnerToken,
        status: analysisJobError ? "FAILED" : "COMPLETED",
        errorMessage: analysisJobError,
      });
    }
  }
}
