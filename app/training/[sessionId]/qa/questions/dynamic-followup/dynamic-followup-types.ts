import type { SerializedDynamicQuestion } from "@/lib/dynamic-followup-question";
import type { DynamicFollowupRegularQuestion } from "@/lib/dynamic-followup-validation";
import type { ProjectAIContext } from "@/lib/project-context";

export interface DynamicFollowupBody {
  protectedQuestionIds?: string[];
  minReplaceableOrderIndex?: number;
  debug?: boolean;
}

export interface DynamicFollowupDebugInfo {
  pitchTextLength?: number;
  pitchTextPreview?: string;
  rawAiOutput?: string;
  normalizedAiOutput?: string;
  validationReason?: string;
  hasProjectContext?: boolean;
  projectTitle?: string | null;
  projectContextLength?: number;
  projectContextPreview?: string;
  regularQuestionsCount?: number;
  regularQuestionsPreview?: string[];
  promptInputSummary?: {
    hasPitchText: boolean;
    hasProjectContext: boolean;
    hasRegularQuestions: boolean;
    hasEvaluationRules: boolean;
  };
  fallbackAttempted?: boolean;
  fallbackRawAiOutput?: string | null;
  fallbackNormalizedOutput?: string | null;
  fallbackValidationReason?: string | null;
  fallbackUsed?: boolean;
  contentFallbackAttempted?: boolean;
  contentFallbackRawAiOutput?: string | null;
  contentFallbackNormalizedOutput?: string | null;
  contentFallbackValidationReason?: string | null;
  contentFallbackUsed?: boolean;
  contentFallbackRetryAttempted?: boolean;
  contentFallbackRetryRawAiOutput?: string | null;
  contentFallbackRetryNormalizedOutput?: string | null;
  contentFallbackRetryValidationReason?: string | null;
  contentFallbackRetryUsed?: boolean;
  contentFallbackError?: string | null;
  otherQuestionsCount?: number;
  otherQuestionsPreview?: string[];
  hasPitchProjectContent?: boolean;
  pitchProjectContentMatchedKeywords?: string[];
  transcriptProjectSignalCount?: number;
  matchedProjectSignals?: string[];
  hasProjectNameInTranscript?: boolean;
  hasSparseProjectContext?: boolean;
  preflightSkippedReason?: string;
  usedStage?: "main" | "mismatch" | "content";
}

export type DynamicFollowupSessionRecord = Readonly<{
  projectId: string;
  status: string;
  projectContextSnapshot: string | null;
}>;

export type PreparedDynamicFollowupInput = Readonly<{
  sessionId: string;
  projectId: string;
  pitchTranscriptText: string;
  transcriptText: string;
  aiContext: ProjectAIContext | null;
  projectName: string | null;
  projectContextText: string;
  otherQuestions: DynamicFollowupRegularQuestion[];
  otherQuestionsText: string;
}>;

export type DynamicFollowupPreparationResult =
  | Readonly<{
      kind: "ready";
      input: PreparedDynamicFollowupInput;
    }>
  | Readonly<{
      kind: "skipped";
      reason: string;
      successful: boolean;
      status?: number;
    }>;

export type DynamicFollowupGenerationResult =
  | Readonly<{
      kind: "created";
      question: SerializedDynamicQuestion;
    }>
  | Readonly<{
      kind: "skipped";
      reason: "no_dynamic_followup" | "ai_generation_failed";
    }>;
