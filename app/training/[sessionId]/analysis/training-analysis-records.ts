import type { TrainingAnalysis } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { isFallbackTrainingAnalysis } from "@/lib/training-analysis-fallback";
import { getTrainingAnalysisGenerationContract } from "@/lib/training-analysis-version.mjs";
import type {
  DynamicFollowupReview,
  QaReview,
  TrainingAnalysisResult,
} from "@/lib/training-analysis-validator";

const PITCH_ANALYSIS_TYPE = "PITCH";
export const TRAINING_ANALYSIS_PROCESSING_TIMEOUT_MS = 5 * 60 * 1_000;
const generationContract = getTrainingAnalysisGenerationContract();

function parseStoredJson<T>(value: string, fallback: T): T {
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

export const getTrainingAnalysisJobKey = (sessionId: string) =>
  `training-analysis:${sessionId}`;

export function serializeTrainingAnalysis(analysis: TrainingAnalysis) {
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

export function isProcessingTrainingAnalysisFresh(analysis: TrainingAnalysis) {
  return (
    analysis.status === "PROCESSING" &&
    Date.now() - analysis.updatedAt.getTime() <
      TRAINING_ANALYSIS_PROCESSING_TIMEOUT_MS
  );
}

export async function findLatestTrainingAnalysis(sessionId: string) {
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

export async function findCurrentTrainingAnalysis(sessionId: string) {
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

export async function getQaTranscriptStatus(sessionId: string) {
  const qaTranscripts = await prisma.trainingTranscript.findMany({
    where: {
      sessionId,
      recording: { phase: "QA" },
    },
    select: {
      status: true,
    },
  });

  return {
    total: qaTranscripts.length,
    pendingCount: qaTranscripts.filter(
      (transcript) =>
        transcript.status === "PENDING" || transcript.status === "PROCESSING",
    ).length,
    completedCount: qaTranscripts.filter(
      (transcript) => transcript.status === "COMPLETED",
    ).length,
    failedCount: qaTranscripts.filter(
      (transcript) => transcript.status === "FAILED",
    ).length,
    canGenerate:
      qaTranscripts.length > 0 &&
      qaTranscripts.every(
        (transcript) =>
          transcript.status === "COMPLETED" || transcript.status === "FAILED",
      ),
  };
}

export async function createProcessingTrainingAnalysis(input: {
  sessionId: string;
  projectId: string;
  transcriptId: string | null;
  durationSec: number;
  pageCount: number | null;
  slideEventCount: number;
  transcriptMissing: boolean;
  inputHash: string;
}) {
  return prisma.trainingAnalysis.create({
    data: {
      sessionId: input.sessionId,
      projectId: input.projectId,
      transcriptId: input.transcriptId,
      status: "PROCESSING",
      analysisType: PITCH_ANALYSIS_TYPE,
      durationSec: input.durationSec,
      pageCount: input.pageCount,
      slideEventCount: input.slideEventCount,
      overallScore: null,
      summary: input.transcriptMissing
        ? "路演自动转写缺失或失败，分析基于项目材料与答辩数据降级生成。"
        : "",
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
      promptVersion: generationContract.promptVersion,
      schemaVersion: generationContract.schemaVersion,
      modelVersion: generationContract.modelVersion,
      ruleVersion: generationContract.ruleVersion,
    },
  });
}
