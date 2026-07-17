import type { SerializedDynamicQuestion } from "@/lib/dynamic-followup-question";
import type { DynamicFollowupDebugInfo } from "./dynamic-followup-types";

type DebugResponseProps = Readonly<{
  skipped?: boolean;
  reason?: string;
  error?: string;
}>;

export function buildDynamicFollowupDebugResponse(
  debug: boolean,
  debugInfo: DynamicFollowupDebugInfo,
  props: DebugResponseProps,
) {
  const base = { ok: false, skipped: true, ...props };
  return debug ? { ...base, debug: debugInfo } : base;
}

export function buildDynamicFollowupSkippedSuccessResponse(
  debug: boolean,
  debugInfo: DynamicFollowupDebugInfo,
  reason: string,
) {
  const base = { ok: true, skipped: true, reason };
  return debug ? { ...base, debug: debugInfo } : base;
}

export function buildDynamicFollowupSuccessResponse(
  debug: boolean,
  debugInfo: DynamicFollowupDebugInfo,
  question: SerializedDynamicQuestion,
) {
  const base = {
    ok: true,
    createdQuestion: question,
    createdQuestionId: question.id,
    orderIndex: question.orderIndex,
    questionText: question.questionText,
    source: question.source,
  };
  return debug ? { ...base, debug: debugInfo } : base;
}

export function buildDynamicFollowupUnexpectedFailureResponse(
  debug: boolean,
  debugInfo: DynamicFollowupDebugInfo,
) {
  const base = {
    ok: true,
    skipped: true,
    reason: "ai_generation_failed",
  };
  return debug ? { ...base, debug: debugInfo } : base;
}
