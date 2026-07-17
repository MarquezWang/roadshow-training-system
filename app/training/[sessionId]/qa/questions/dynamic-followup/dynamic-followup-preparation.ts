import { devLog } from "@/lib/dev-log";
import {
  buildDynamicFollowupProjectContext,
  evaluateDynamicFollowupPreflight,
} from "@/lib/dynamic-followup-context";
import { DYNAMIC_FOLLOWUP_SOURCE } from "@/lib/dynamic-followup-question";
import { prisma } from "@/lib/prisma";
import {
  buildProjectAIContext,
  parseProjectAIContextSnapshot,
  type ProjectAIContext,
} from "@/lib/project-context";
import { dynamicQuestionTrainingStatuses } from "@/lib/training-status";
import type {
  DynamicFollowupDebugInfo,
  DynamicFollowupPreparationResult,
  DynamicFollowupSessionRecord,
} from "./dynamic-followup-types";

export const MIN_DYNAMIC_FOLLOWUP_TRANSCRIPT_CHARS = 80;

function previewQuestions(questions: Array<{ questionText: string }>) {
  return questions
    .slice(0, 3)
    .map((question) =>
      question.questionText.length > 100
        ? `${question.questionText.slice(0, 100)}...`
        : question.questionText,
    );
}

export async function prepareDynamicFollowupGeneration(params: {
  sessionId: string;
  session: DynamicFollowupSessionRecord;
  legacyProtectedCount: number;
  legacyMinReplaceableOrderIndex: number;
  debugInfo: DynamicFollowupDebugInfo;
}): Promise<DynamicFollowupPreparationResult> {
  const { sessionId, session, debugInfo } = params;
  const pitchTranscript = await prisma.trainingTranscript.findFirst({
    where: {
      sessionId,
      status: "COMPLETED",
      text: { not: "" },
      recording: { phase: "PITCH" },
    },
    orderBy: { updatedAt: "desc" },
    select: {
      id: true,
      text: true,
      status: true,
    },
  });

  if (!pitchTranscript) {
    devLog("[dynamic-followup:POST] pitch transcript not ready", {
      sessionId,
    });
    debugInfo.validationReason = "pitch_transcript_not_ready";
    return {
      kind: "skipped",
      reason: "pitch_transcript_not_ready",
      successful: false,
    };
  }

  const transcriptText = pitchTranscript.text.trim();
  if (transcriptText.length < MIN_DYNAMIC_FOLLOWUP_TRANSCRIPT_CHARS) {
    devLog("[dynamic-followup:POST] pitch transcript too short", {
      sessionId,
      textLength: transcriptText.length,
    });
    debugInfo.pitchTextLength = transcriptText.length;
    debugInfo.pitchTextPreview = transcriptText.slice(0, 200);
    debugInfo.validationReason = "pitch_transcript_too_short";
    return {
      kind: "skipped",
      reason: "pitch_transcript_too_short",
      successful: false,
    };
  }

  const questions = await prisma.trainingQuestion.findMany({
    where: { sessionId },
    orderBy: { orderIndex: "asc" },
    include: {
      answer: {
        select: { id: true },
      },
    },
  });

  if (questions.length === 0) {
    devLog("[dynamic-followup:POST] no questions found", { sessionId });
    debugInfo.validationReason = "no_base_questions";
    debugInfo.regularQuestionsCount = 0;
    debugInfo.regularQuestionsPreview = [];
    return {
      kind: "skipped",
      reason: "no_base_questions",
      successful: false,
    };
  }

  debugInfo.regularQuestionsCount = questions.length;
  debugInfo.regularQuestionsPreview = previewQuestions(questions);

  devLog("[dynamic-followup:POST] generating dynamic followup append", {
    sessionId,
    questionsCount: questions.length,
    legacyProtectedCount: params.legacyProtectedCount,
    legacyMinReplaceableOrderIndex: params.legacyMinReplaceableOrderIndex,
  });

  const otherQuestions = questions.filter(
    (question) => question.source !== DYNAMIC_FOLLOWUP_SOURCE,
  );
  const otherQuestionsText = otherQuestions
    .map((question) => `第${question.orderIndex}题：${question.questionText}`)
    .join("\n");

  debugInfo.otherQuestionsCount = otherQuestions.length;
  debugInfo.otherQuestionsPreview = previewQuestions(otherQuestions);

  let aiContext: ProjectAIContext | null;
  try {
    aiContext =
      parseProjectAIContextSnapshot(session.projectContextSnapshot) ??
      (await buildProjectAIContext(session.projectId));
  } catch {
    devLog("[dynamic-followup:POST] project context not found, using minimal", {
      sessionId,
    });
    aiContext = null;
  }

  if (
    !dynamicQuestionTrainingStatuses.includes(
      session.status as (typeof dynamicQuestionTrainingStatuses)[number],
    )
  ) {
    return {
      kind: "skipped",
      reason: "session_not_open_for_followup",
      successful: false,
      status: 409,
    };
  }

  const { projectName, projectDetailText, projectContextText } =
    buildDynamicFollowupProjectContext(aiContext);
  debugInfo.hasProjectContext = projectContextText.length > 0;
  debugInfo.projectTitle = projectName;
  debugInfo.projectContextLength = projectContextText.length;
  debugInfo.projectContextPreview = projectContextText.slice(0, 200);

  const {
    pitchProjectContent,
    hasSparseProjectContext,
    isClearlyUnrelatedPitch,
    shouldSkip,
  } = evaluateDynamicFollowupPreflight({
    aiContext,
    projectDetailText,
    projectName,
    transcriptText,
  });

  debugInfo.transcriptProjectSignalCount =
    pitchProjectContent.matchedProjectSignals.length;
  debugInfo.matchedProjectSignals = pitchProjectContent.matchedProjectSignals;
  debugInfo.hasProjectNameInTranscript =
    pitchProjectContent.hasProjectNameInTranscript;
  debugInfo.hasSparseProjectContext = hasSparseProjectContext;

  devLog("[dynamic-followup:POST] preflight project content check", {
    sessionId,
    transcriptProjectSignalCount:
      pitchProjectContent.matchedProjectSignals.length,
    matchedProjectSignals: pitchProjectContent.matchedProjectSignals,
    hasProjectNameInTranscript: pitchProjectContent.hasProjectNameInTranscript,
    hasSparseProjectContext,
    hasEnoughProjectPitchContent:
      pitchProjectContent.hasEnoughProjectPitchContent,
    isClearlyUnrelatedPitch,
  });

  if (shouldSkip) {
    const reason = "insufficient_project_pitch_content";
    debugInfo.pitchTextLength = transcriptText.length;
    debugInfo.pitchTextPreview = transcriptText.slice(0, 200);
    debugInfo.validationReason = reason;
    debugInfo.preflightSkippedReason = reason;
    devLog("[dynamic-followup:POST] skipped by preflight", {
      sessionId,
      reason,
      transcriptProjectSignalCount:
        pitchProjectContent.matchedProjectSignals.length,
      matchedProjectSignals: pitchProjectContent.matchedProjectSignals,
      hasProjectNameInTranscript:
        pitchProjectContent.hasProjectNameInTranscript,
      hasSparseProjectContext,
    });
    return {
      kind: "skipped",
      reason,
      successful: true,
    };
  }

  debugInfo.promptInputSummary = {
    hasPitchText: transcriptText.length > 0,
    hasProjectContext: projectContextText.length > 0,
    hasRegularQuestions: otherQuestionsText.length > 0,
    hasEvaluationRules:
      Boolean(aiContext?.evaluationRule) ||
      (aiContext?.criteria ?? []).length > 0,
  };

  return {
    kind: "ready",
    input: {
      sessionId,
      projectId: session.projectId,
      pitchTranscriptText: pitchTranscript.text,
      transcriptText,
      aiContext,
      projectName,
      projectContextText,
      otherQuestions: otherQuestions.map((question) => ({
        questionText: question.questionText,
      })),
      otherQuestionsText,
    },
  };
}
