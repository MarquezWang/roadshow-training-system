"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { devLog } from "@/lib/dev-log";
import {
  appendDynamicFollowupQuestion,
  canAttemptDynamicFollowupPhase,
  canScheduleDynamicFollowupRetry,
  DYNAMIC_FOLLOWUP_MAX_RETRY_COUNT,
  DYNAMIC_FOLLOWUP_RETRY_DELAY_MS,
  getProtectedQuestionIds,
  isDynamicFollowupQuestion,
  isTranscriptNotReadyReason,
} from "./policy";
import type {
  QaGenerationQuestion,
  QaGenerationPhase,
  UseDynamicFollowupQuestionOptions,
} from "./types";

type DynamicFollowupResponse = {
  ok: boolean;
  skipped?: boolean;
  reason?: string;
  createdQuestion?: QaGenerationQuestion;
  createdQuestionId?: string;
  questionText?: string;
  source?: string;
};

export function useDynamicFollowupQuestion({
  sessionId,
  dynamicFollowupExperiment,
  isGuardResolved,
  qaPhase,
  questions,
  setQuestions,
}: UseDynamicFollowupQuestionOptions) {
  const qaPhaseRef = useRef<QaGenerationPhase>(qaPhase);
  const retryCountRef = useRef(0);
  const inFlightRef = useRef(false);
  const completedRef = useRef(questions.some(isDynamicFollowupQuestion));
  const retryTimerRef = useRef<number | null>(null);
  const [retryTick, setRetryTick] = useState(0);

  const clearRetryTimer = useCallback(() => {
    if (retryTimerRef.current !== null) {
      window.clearTimeout(retryTimerRef.current);
      retryTimerRef.current = null;
    }
  }, []);

  const scheduleRetry = useCallback(
    (reason: string) => {
      if (
        !canScheduleDynamicFollowupRetry(
          qaPhaseRef.current,
          retryCountRef.current,
        )
      ) {
        if (canAttemptDynamicFollowupPhase(qaPhaseRef.current)) {
          completedRef.current = true;
          clearRetryTimer();
          devLog("[dynamic-followup:client] retry stopped", {
            sessionId,
            reason,
            retryCount: retryCountRef.current,
            maxRetryCount: DYNAMIC_FOLLOWUP_MAX_RETRY_COUNT,
          });
        }
        return;
      }

      clearRetryTimer();
      retryCountRef.current += 1;
      const nextRetryCount = retryCountRef.current;

      devLog("[dynamic-followup:client] retry scheduled", {
        sessionId,
        reason,
        retryCount: nextRetryCount,
        delayMs: DYNAMIC_FOLLOWUP_RETRY_DELAY_MS,
      });

      retryTimerRef.current = window.setTimeout(() => {
        retryTimerRef.current = null;
        setRetryTick((currentTick) => currentTick + 1);
      }, DYNAMIC_FOLLOWUP_RETRY_DELAY_MS);
    },
    [clearRetryTimer, sessionId],
  );

  useEffect(() => {
    return () => clearRetryTimer();
  }, [clearRetryTimer]);

  useEffect(() => {
    qaPhaseRef.current = qaPhase;

    if (!canAttemptDynamicFollowupPhase(qaPhase)) {
      clearRetryTimer();
    }
  }, [clearRetryTimer, qaPhase]);

  useEffect(() => {
    if (!canAttemptDynamicFollowupPhase(qaPhase)) {
      clearRetryTimer();
      return;
    }

    if (questions.some(isDynamicFollowupQuestion)) {
      completedRef.current = true;
      clearRetryTimer();
      return;
    }

    if (
      !dynamicFollowupExperiment ||
      !isGuardResolved ||
      questions.length === 0 ||
      completedRef.current ||
      inFlightRef.current ||
      retryTimerRef.current !== null
    ) {
      return;
    }

    const protectedQuestionIds = getProtectedQuestionIds(questions);

    devLog("[dynamic-followup:client] request started", {
      sessionId,
      questionsCount: questions.length,
      protectedCount: protectedQuestionIds.length,
      retryCount: retryCountRef.current,
    });

    inFlightRef.current = true;

    void (async () => {
      try {
        const response = await fetch(
          `/training/${sessionId}/qa/questions/dynamic-followup`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              protectedQuestionIds,
              minReplaceableOrderIndex: 1,
            }),
          },
        );

        if (!canAttemptDynamicFollowupPhase(qaPhaseRef.current)) {
          devLog("[dynamic-followup:client] ignored after phase changed", {
            sessionId,
            qaPhase: qaPhaseRef.current,
          });
          return;
        }

        if (!response.ok) {
          devLog("[dynamic-followup:client] request failed", {
            sessionId,
            status: response.status,
            retryCount: retryCountRef.current,
          });
          scheduleRetry(`http_${response.status}`);
          return;
        }

        const body = (await response.json()) as DynamicFollowupResponse;

        if (body.ok && body.createdQuestion) {
          completedRef.current = true;
          clearRetryTimer();

          devLog("[dynamic-followup:client] appended dynamic question", {
            sessionId,
            createdQuestionId:
              body.createdQuestionId ?? body.createdQuestion.id,
          });

          if (canAttemptDynamicFollowupPhase(qaPhaseRef.current)) {
            const createdQuestion = body.createdQuestion;
            setQuestions((currentQuestions) =>
              appendDynamicFollowupQuestion(currentQuestions, createdQuestion),
            );
          }
        } else {
          const reason = body.reason ?? "unknown";
          devLog("[dynamic-followup:client] skipped", {
            sessionId,
            reason,
            retryCount: retryCountRef.current,
          });

          if (body.skipped && isTranscriptNotReadyReason(reason)) {
            scheduleRetry(reason);
            return;
          }

          completedRef.current = true;
          clearRetryTimer();
        }
      } catch (error) {
        devLog("[dynamic-followup:client] error", {
          sessionId,
          error: String(error),
          retryCount: retryCountRef.current,
        });
        scheduleRetry("network_error");
      } finally {
        inFlightRef.current = false;
      }
    })();
  }, [
    clearRetryTimer,
    dynamicFollowupExperiment,
    isGuardResolved,
    qaPhase,
    questions,
    retryTick,
    scheduleRetry,
    sessionId,
    setQuestions,
  ]);
}
