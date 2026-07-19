import { NextRequest, NextResponse } from "next/server";
import { acquireAsyncJob, releaseAsyncJob } from "@/lib/async-job";
import { createAIResourceLimitResponse } from "@/lib/ai-http-response";
import { isSessionOwnedByCurrentUser } from "@/lib/auth-server";
import { usesExternalBackgroundWorker } from "@/lib/background-task-mode.mjs";
import { prisma } from "@/lib/prisma";
import {
  queueTrainingAnalysisJob,
  startTrainingAnalysisLeaseRenewal,
} from "@/lib/training-analysis-job.mjs";
import {
  executeTrainingAnalysisGeneration,
  getFriendlyTrainingAnalysisError,
  prepareTrainingAnalysisGeneration,
  TrainingAnalysisTaskError,
} from "./training-analysis-executor";
import {
  findCurrentTrainingAnalysis,
  findLatestTrainingAnalysis,
  getQaTranscriptStatus,
  getTrainingAnalysisJobKey,
  isProcessingTrainingAnalysisFresh,
  serializeTrainingAnalysis,
} from "./training-analysis-records";

type TrainingAnalysisRouteContext = Readonly<{
  params: Promise<{
    sessionId: string;
  }>;
}>;

function taskErrorResponse(error: TrainingAnalysisTaskError) {
  return NextResponse.json(
    {
      error: error.message,
      reason: error.reason,
      ...error.details,
    },
    { status: error.status },
  );
}

function shouldFailEmbeddedJob(error: TrainingAnalysisTaskError) {
  return ![
    "session_not_found",
    "training_not_finished",
    "pitch_transcript_processing",
    "qa_transcripts_processing",
  ].includes(error.reason);
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

async function queueExternalTrainingAnalysis(
  sessionId: string,
  forceRegeneration: boolean,
) {
  const prepared = await prepareTrainingAnalysisGeneration({
    sessionId,
    forceRegeneration,
  });
  if (prepared.state === "existing") {
    return NextResponse.json({
      queued: false,
      analysis: serializeTrainingAnalysis(prepared.analysis),
    });
  }

  const queued = await queueTrainingAnalysisJob(prisma, {
    sessionId,
    forceRegeneration,
  });
  const latestAnalysis = await findLatestTrainingAnalysis(sessionId);
  return NextResponse.json(
    {
      queued: true,
      queueState: queued.state,
      jobStatus: queued.job.status,
      analysis: latestAnalysis
        ? serializeTrainingAnalysis(latestAnalysis)
        : null,
    },
    { status: 202 },
  );
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

  if (usesExternalBackgroundWorker()) {
    try {
      return await queueExternalTrainingAnalysis(
        sessionId,
        forceRegeneration,
      );
    } catch (error) {
      if (error instanceof TrainingAnalysisTaskError) {
        return taskErrorResponse(error);
      }
      return NextResponse.json(
        { error: getFriendlyTrainingAnalysisError(error) },
        { status: 500 },
      );
    }
  }

  const acquiredJob = await acquireAsyncJob({
    jobKey: getTrainingAnalysisJobKey(sessionId),
    jobType: "TRAINING_ANALYSIS",
    resourceId: sessionId,
    leaseMs: 15 * 60_000,
  });
  if (!acquiredJob) {
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

  let jobError: string | null = null;
  const leaseRenewal = startTrainingAnalysisLeaseRenewal(prisma, {
    sessionId,
    ownerToken: acquiredJob.ownerToken,
  });
  try {
    const analysis = await executeTrainingAnalysisGeneration({
      sessionId,
      ownerToken: acquiredJob.ownerToken,
      forceRegeneration,
    });
    return NextResponse.json({ analysis: serializeTrainingAnalysis(analysis) });
  } catch (error) {
    const message = getFriendlyTrainingAnalysisError(error);
    const resourceLimitResponse = createAIResourceLimitResponse(error);
    if (resourceLimitResponse) {
      jobError = message;
      return resourceLimitResponse;
    }
    if (error instanceof TrainingAnalysisTaskError) {
      if (shouldFailEmbeddedJob(error)) jobError = message;
      return taskErrorResponse(error);
    }
    jobError = message;
    return NextResponse.json({ error: message }, { status: 500 });
  } finally {
    await leaseRenewal.stop();
    await releaseAsyncJob({
      jobKey: getTrainingAnalysisJobKey(sessionId),
      ownerToken: acquiredJob.ownerToken,
      status: jobError ? "FAILED" : "COMPLETED",
      errorMessage: jobError,
    });
  }
}
