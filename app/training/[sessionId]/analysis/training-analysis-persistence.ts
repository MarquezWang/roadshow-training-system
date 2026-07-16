import { prisma } from "@/lib/prisma";
import { calculateTrainingAnalysisInputHash } from "@/lib/training-analysis-input";
import {
  buildStoredTrainingAnalysisResult,
  type TrainingAnalysisParseFailureDebug,
} from "@/lib/training-analysis-ai";
import type { TrainingAnalysisFallbackReason } from "@/lib/training-analysis-fallback";
import {
  buildFallbackTrainingAnalysis,
  type TrainingAnalysisQuestionData,
} from "@/lib/training-analysis-fallback-builder";
import { publishTrainingAnalysis } from "@/lib/training-analysis-publication.mjs";
import type { TrainingAnalysisResult } from "@/lib/training-analysis-validator";
import { getTrainingAnalysisJobKey } from "./training-analysis-records";

type PublicationIdentity = Readonly<{
  sessionId: string;
  ownerToken: string | null;
  analysisId: string;
  inputHash: string;
}>;

export async function hasTrainingAnalysisInputChanged(
  input: Readonly<{
    sessionId: string;
    analysisId: string;
    expectedInputHash: string;
  }>,
) {
  const latestInputHash = await calculateTrainingAnalysisInputHash(
    input.sessionId,
  );
  if (latestInputHash && latestInputHash === input.expectedInputHash) {
    return false;
  }

  await markTrainingAnalysisFailed(
    input.analysisId,
    "报告生成期间训练输入发生变化，请重新生成。",
  );
  return true;
}

export async function publishNoAnalyzableTextTrainingAnalysis(
  identity: PublicationIdentity,
  input: Readonly<{
    durationSec: number;
    pageCount: number | null;
    slideEventCount: number;
    transcriptMissing: boolean;
    qaData: TrainingAnalysisQuestionData[];
    dynamicFollowupData: TrainingAnalysisQuestionData | null;
  }>,
) {
  const fallbackAnalysis = buildFallbackTrainingAnalysis({
    ...input,
    failureReason: "NO_ANALYZABLE_TEXT",
  });

  return publishTrainingAnalysis(prisma, {
    jobKey: getTrainingAnalysisJobKey(identity.sessionId),
    ownerToken: identity.ownerToken,
    sessionId: identity.sessionId,
    analysisId: identity.analysisId,
    inputHash: identity.inputHash,
    data: {
      overallScore: fallbackAnalysis.overallScore,
      summary:
        "本轮路演与答辩转写文本不可用，系统已生成降级报告。答辩回答内容无法基于文本完整评分，请结合录音回放人工复核。",
      strengthsJson: JSON.stringify(fallbackAnalysis.strengths, null, 2),
      weaknessesJson: JSON.stringify(fallbackAnalysis.weaknesses, null, 2),
      suggestionsJson: JSON.stringify(fallbackAnalysis.suggestions, null, 2),
      coverageJson: JSON.stringify(fallbackAnalysis.contentCoverage, null, 2),
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
}

export async function publishGeneratedTrainingAnalysis(
  identity: PublicationIdentity,
  input: Readonly<{
    analysis: TrainingAnalysisResult;
    debug: TrainingAnalysisParseFailureDebug | null;
    fallbackReason: TrainingAnalysisFallbackReason | null;
  }>,
) {
  return publishTrainingAnalysis(prisma, {
    jobKey: getTrainingAnalysisJobKey(identity.sessionId),
    ownerToken: identity.ownerToken,
    sessionId: identity.sessionId,
    analysisId: identity.analysisId,
    inputHash: identity.inputHash,
    data: {
      overallScore: input.analysis.overallScore,
      summary: input.analysis.summary,
      strengthsJson: JSON.stringify(input.analysis.strengths, null, 2),
      weaknessesJson: JSON.stringify(input.analysis.weaknesses, null, 2),
      suggestionsJson: JSON.stringify(input.analysis.suggestions, null, 2),
      coverageJson: JSON.stringify(input.analysis.contentCoverage, null, 2),
      timingJson: JSON.stringify(input.analysis.timing, null, 2),
      slideSyncJson: JSON.stringify(input.analysis.slideSync, null, 2),
      riskQuestionsJson: JSON.stringify(input.analysis.riskQuestions, null, 2),
      rawResultJson: buildStoredTrainingAnalysisResult(
        input.analysis,
        input.debug,
      ),
      errorMessage: input.debug
        ? input.debug.reason === "AI_EMPTY_CONTENT"
          ? "AI 返回内容为空，已生成降级报告。详情见 rawResultJson._debug。"
          : "AI 结构化输出不符合报告 Schema，修复重试失败后已生成降级报告。详情见 rawResultJson._debug。"
        : null,
      isFallback: input.fallbackReason !== null,
      fallbackReason: input.fallbackReason,
    },
  });
}

export async function markTrainingAnalysisFailed(
  analysisId: string,
  errorMessage: string,
) {
  await prisma.trainingAnalysis.update({
    where: { id: analysisId },
    data: {
      status: "FAILED",
      errorMessage,
    },
  });
}
