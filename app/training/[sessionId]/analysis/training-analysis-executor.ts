import type { TrainingAnalysis } from "@prisma/client";
import { AIResourceLimitError } from "@/lib/ai-resource-guard";
import {
  buildProjectAIContext,
  parseProjectAIContextSnapshot,
  ProjectContextNotFoundError,
} from "@/lib/project-context";
import { loadPromptTemplate } from "@/lib/prompt-loader";
import { devError, devLog } from "@/lib/dev-log";
import {
  calculateTrainingAnalysisInputHash,
  reconcileTrainingAnalysisInputVersion,
} from "@/lib/training-analysis-input";
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
  findLatestTrainingAnalysis,
  isProcessingTrainingAnalysisFresh,
  TRAINING_ANALYSIS_PROCESSING_TIMEOUT_MS,
} from "./training-analysis-records";

type TrainingAnalysisTaskErrorOptions = Readonly<{
  status: number;
  reason: string;
  retryable: boolean;
  details?: Readonly<Record<string, unknown>>;
}>;

export class TrainingAnalysisTaskError extends Error {
  readonly status: number;
  readonly reason: string;
  readonly retryable: boolean;
  readonly details: Readonly<Record<string, unknown>>;

  constructor(message: string, options: TrainingAnalysisTaskErrorOptions) {
    super(message);
    this.name = "TrainingAnalysisTaskError";
    this.status = options.status;
    this.reason = options.reason;
    this.retryable = options.retryable;
    this.details = options.details ?? {};
  }
}

export function getFriendlyTrainingAnalysisError(error: unknown) {
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

export type PreparedTrainingAnalysisGeneration =
  | Readonly<{
      state: "existing";
      analysis: TrainingAnalysis;
      inputHash: string;
    }>
  | Readonly<{
      state: "ready";
      session: NonNullable<
        Awaited<ReturnType<typeof findTrainingAnalysisSession>>
      >;
      inputHash: string;
    }>;

export async function prepareTrainingAnalysisGeneration({
  sessionId,
  forceRegeneration,
}: Readonly<{
  sessionId: string;
  forceRegeneration: boolean;
}>): Promise<PreparedTrainingAnalysisGeneration> {
  const session = await findTrainingAnalysisSession(sessionId);
  if (!session) {
    throw new TrainingAnalysisTaskError("训练场次不存在。", {
      status: 404,
      reason: "session_not_found",
      retryable: false,
    });
  }

  const inputHash = await calculateTrainingAnalysisInputHash(sessionId);
  if (!inputHash) {
    throw new TrainingAnalysisTaskError("训练场次不存在。", {
      status: 404,
      reason: "session_not_found",
      retryable: false,
    });
  }

  const existingAnalysis = await findLatestTrainingAnalysis(sessionId);
  if (existingAnalysis?.status === "PROCESSING") {
    if (isProcessingTrainingAnalysisFresh(existingAnalysis)) {
      return { state: "existing", analysis: existingAnalysis, inputHash };
    }
    devLog("[analysis] stale processing analysis detected, taking over", {
      sessionId,
      analysisId: existingAnalysis.id,
      processingAgeMs: Date.now() - existingAnalysis.updatedAt.getTime(),
      timeoutMs: TRAINING_ANALYSIS_PROCESSING_TIMEOUT_MS,
    });
  }

  if (existingAnalysis?.status === "COMPLETED") {
    const staleCheck = await reconcileTrainingAnalysisInputVersion(
      sessionId,
      existingAnalysis,
    );
    if (!staleCheck.stale && !forceRegeneration) {
      return {
        state: "existing",
        analysis: {
          ...existingAnalysis,
          inputHash:
            staleCheck.currentInputHash ?? existingAnalysis.inputHash,
        },
        inputHash: staleCheck.currentInputHash ?? existingAnalysis.inputHash,
      };
    }
    devLog("[analysis] regenerating completed analysis", {
      sessionId,
      forceRegeneration,
      staleReason: staleCheck.reason,
      analysisUpdatedAt: existingAnalysis.updatedAt.toISOString(),
    });
  }

  if (!canGenerateTrainingAnalysis(session)) {
    throw new TrainingAnalysisTaskError("请先结束路演后再分析。", {
      status: 400,
      reason: "training_not_finished",
      retryable: false,
    });
  }

  const transcriptWaitState =
    await getTrainingAnalysisTranscriptWaitState(session);
  if (transcriptWaitState.kind === "pitch") {
    throw new TrainingAnalysisTaskError("路演转写正在进行中，请稍后再试。", {
      status: 409,
      reason: "pitch_transcript_processing",
      retryable: true,
      details: {
        transcriptProcessing: true,
        transcriptStatus: transcriptWaitState.transcriptStatus,
      },
    });
  }
  if (transcriptWaitState.kind === "qa") {
    throw new TrainingAnalysisTaskError(
      "答辩回答转写尚未完成，请稍后重试。",
      {
        status: 409,
        reason: "qa_transcripts_processing",
        retryable: true,
        details: {
          qaTranscriptsProcessing: true,
          pendingCount: transcriptWaitState.pendingCount,
        },
      },
    );
  }

  return { state: "ready", session, inputHash };
}

export async function executeTrainingAnalysisGeneration({
  sessionId,
  ownerToken,
  forceRegeneration,
}: Readonly<{
  sessionId: string;
  ownerToken: string;
  forceRegeneration: boolean;
}>): Promise<TrainingAnalysis> {
  let processingAnalysisId: string | null = null;

  try {
    const prepared = await prepareTrainingAnalysisGeneration({
      sessionId,
      forceRegeneration,
    });
    if (prepared.state === "existing") return prepared.analysis;

    const { session, inputHash } = prepared;
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
      inputHash,
    });
    processingAnalysisId = processingAnalysis.id;

    if (!hasAnalyzableText) {
      if (
        await hasTrainingAnalysisInputChanged({
          sessionId,
          analysisId: processingAnalysis.id,
          expectedInputHash: inputHash,
        })
      ) {
        processingAnalysisId = null;
        throw new TrainingAnalysisTaskError(
          "报告生成期间训练输入发生变化，请重新生成。",
          {
            status: 409,
            reason: "analysis_input_changed",
            retryable: true,
          },
        );
      }

      const completedAnalysis =
        await publishNoAnalyzableTextTrainingAnalysis(
          {
            sessionId,
            ownerToken,
            analysisId: processingAnalysis.id,
            inputHash,
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
      return completedAnalysis;
    }

    const snapshotContext = parseProjectAIContextSnapshot(
      session.projectContextSnapshot,
      session.contextSchemaVersion,
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
      userId: session.project.ownerId,
      projectId: session.projectId,
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

    if (
      await hasTrainingAnalysisInputChanged({
        sessionId,
        analysisId: processingAnalysis.id,
        expectedInputHash: inputHash,
      })
    ) {
      processingAnalysisId = null;
      throw new TrainingAnalysisTaskError(
        "报告生成期间训练输入发生变化，请重新生成。",
        {
          status: 409,
          reason: "analysis_input_changed",
          retryable: true,
        },
      );
    }

    const completedAnalysis = await publishGeneratedTrainingAnalysis(
      {
        sessionId,
        ownerToken,
        analysisId: processingAnalysis.id,
        inputHash,
      },
      {
        analysis: analysisJson,
        debug: generation.debug,
        fallbackReason: generation.fallbackReason,
      },
    );
    processingAnalysisId = null;
    return completedAnalysis;
  } catch (error) {
    const message = getFriendlyTrainingAnalysisError(error);
    if (processingAnalysisId) {
      await markTrainingAnalysisFailed(processingAnalysisId, message);
    }
    if (error instanceof AIResourceLimitError) throw error;
    if (error instanceof TrainingAnalysisTaskError) throw error;
    if (error instanceof ProjectContextNotFoundError) {
      throw new TrainingAnalysisTaskError(error.message, {
        status: 404,
        reason: "project_context_not_found",
        retryable: false,
      });
    }

    devError("路演表现分析生成失败。", { error: message });
    throw new TrainingAnalysisTaskError(message, {
      status: 500,
      reason: "analysis_generation_failed",
      retryable: true,
    });
  }
}
