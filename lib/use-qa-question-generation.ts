"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type Dispatch,
  type SetStateAction,
} from "react";
import { devLog } from "@/lib/dev-log";

export type QaGenerationQuestion = {
  id: string;
  orderIndex: number;
  questionText: string;
  questionType: string | null;
  source: string;
  basis: string | null;
  answer: {
    id: string;
    answerText: string | null;
    revealedQuestionText: boolean;
    startedAt: string | null;
    endedAt: string | null;
    durationSec: number | null;
  } | null;
};

type QaGenerationPhase =
  | "READY"
  | "ASKING"
  | "COUNTDOWN"
  | "ANSWERING"
  | "SAVING"
  | "DONE";

type UseQaQuestionGenerationOptions = {
  sessionId: string;
  dynamicFollowupExperiment: boolean;
  isGuardResolved: boolean;
  qaPhase: QaGenerationPhase;
  questions: QaGenerationQuestion[];
  setQuestions: Dispatch<SetStateAction<QaGenerationQuestion[]>>;
  setCurrentQuestionIndex: (questionIndex: number) => void;
  setMessage: (message: string) => void;
};

const dynamicFollowupRetryDelayMs = 3_000;
const dynamicFollowupMaxRetryCount = 10;

function canAttemptDynamicFollowupPhase(phase: QaGenerationPhase) {
  return phase !== "DONE";
}

function isDynamicFollowupQuestion(question: QaGenerationQuestion | null) {
  return (
    question?.source === "DYNAMIC_FOLLOWUP" ||
    question?.questionType === "FOLLOWUP"
  );
}

function isTranscriptNotReadyReason(reason: string | undefined) {
  if (!reason) {
    return false;
  }

  const normalizedReason = reason.trim().toLowerCase();

  return (
    normalizedReason === "dynamic_followup_in_progress" ||
    normalizedReason === "pitch_transcript_not_ready" ||
    normalizedReason === "transcript_not_ready" ||
    normalizedReason === "no_pitch_transcript" ||
    (normalizedReason.includes("transcript") &&
      (normalizedReason.includes("not_ready") ||
        normalizedReason.includes("not ready") ||
        normalizedReason.includes("missing")))
  );
}

export function useQaQuestionGeneration({
  sessionId,
  dynamicFollowupExperiment,
  isGuardResolved,
  qaPhase,
  questions,
  setQuestions,
  setCurrentQuestionIndex,
  setMessage,
}: UseQaQuestionGenerationOptions) {
  const [isGenerating, setIsGenerating] = useState(false);
  const autoGenerateRef = useRef(false);
  const qaPhaseRef = useRef<QaGenerationPhase>(qaPhase);
  const dynamicFollowupRetryCountRef = useRef(0);
  const dynamicFollowupInFlightRef = useRef(false);
  const dynamicFollowupCompletedRef = useRef(
    questions.some(isDynamicFollowupQuestion),
  );
  const dynamicFollowupRetryTimerRef = useRef<number | null>(null);
  const [dynamicFollowupRetryTick, setDynamicFollowupRetryTick] = useState(0);

  const clearDynamicFollowupRetryTimer = useCallback(() => {
    if (dynamicFollowupRetryTimerRef.current !== null) {
      window.clearTimeout(dynamicFollowupRetryTimerRef.current);
      dynamicFollowupRetryTimerRef.current = null;
    }
  }, []);

  const scheduleDynamicFollowupRetry = useCallback(
    (reason: string) => {
      if (!canAttemptDynamicFollowupPhase(qaPhaseRef.current)) {
        return;
      }

      if (dynamicFollowupRetryCountRef.current >= dynamicFollowupMaxRetryCount) {
        dynamicFollowupCompletedRef.current = true;
        clearDynamicFollowupRetryTimer();
        devLog("[dynamic-followup:client] retry stopped", {
          sessionId,
          reason,
          retryCount: dynamicFollowupRetryCountRef.current,
          maxRetryCount: dynamicFollowupMaxRetryCount,
        });
        return;
      }

      clearDynamicFollowupRetryTimer();
      dynamicFollowupRetryCountRef.current += 1;
      const nextRetryCount = dynamicFollowupRetryCountRef.current;

      devLog("[dynamic-followup:client] retry scheduled", {
        sessionId,
        reason,
        retryCount: nextRetryCount,
        delayMs: dynamicFollowupRetryDelayMs,
      });

      dynamicFollowupRetryTimerRef.current = window.setTimeout(() => {
        dynamicFollowupRetryTimerRef.current = null;
        setDynamicFollowupRetryTick((currentTick) => currentTick + 1);
      }, dynamicFollowupRetryDelayMs);
    },
    [clearDynamicFollowupRetryTimer, sessionId],
  );

  useEffect(() => {
    return () => clearDynamicFollowupRetryTimer();
  }, [clearDynamicFollowupRetryTimer]);

  useEffect(() => {
    qaPhaseRef.current = qaPhase;

    if (!canAttemptDynamicFollowupPhase(qaPhase)) {
      clearDynamicFollowupRetryTimer();
    }
  }, [clearDynamicFollowupRetryTimer, qaPhase]);

  // Dynamic followup: retry while pitch transcript is not ready.
  useEffect(() => {
    if (!canAttemptDynamicFollowupPhase(qaPhase)) {
      clearDynamicFollowupRetryTimer();
      return;
    }

    if (questions.some(isDynamicFollowupQuestion)) {
      dynamicFollowupCompletedRef.current = true;
      clearDynamicFollowupRetryTimer();
      return;
    }

    if (
      !dynamicFollowupExperiment ||
      !isGuardResolved ||
      questions.length === 0 ||
      dynamicFollowupCompletedRef.current ||
      dynamicFollowupInFlightRef.current ||
      dynamicFollowupRetryTimerRef.current !== null
    ) {
      return;
    }

    const protectedQuestionIds = questions
      .filter(
        (question) =>
          question.answer?.revealedQuestionText ||
          question.answer?.startedAt ||
          question.answer?.endedAt,
      )
      .map((question) => question.id);

    devLog("[dynamic-followup:client] request started", {
      sessionId,
      questionsCount: questions.length,
      protectedCount: protectedQuestionIds.length,
      retryCount: dynamicFollowupRetryCountRef.current,
    });

    dynamicFollowupInFlightRef.current = true;

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
            retryCount: dynamicFollowupRetryCountRef.current,
          });
          scheduleDynamicFollowupRetry(`http_${response.status}`);
          return;
        }

        const body = (await response.json()) as {
          ok: boolean;
          skipped?: boolean;
          reason?: string;
          createdQuestion?: QaGenerationQuestion;
          createdQuestionId?: string;
          questionText?: string;
          source?: string;
        };

        if (body.ok && body.createdQuestion) {
          dynamicFollowupCompletedRef.current = true;
          clearDynamicFollowupRetryTimer();

          devLog("[dynamic-followup:client] appended dynamic question", {
            sessionId,
            createdQuestionId:
              body.createdQuestionId ?? body.createdQuestion.id,
          });

          if (canAttemptDynamicFollowupPhase(qaPhaseRef.current)) {
            setQuestions((currentQuestions) => {
              const hasDynamicQuestion = currentQuestions.some(
                (question) =>
                  question.id === body.createdQuestion!.id ||
                  (question.orderIndex === body.createdQuestion!.orderIndex &&
                    question.source === "DYNAMIC_FOLLOWUP"),
              );

              if (hasDynamicQuestion) {
                return currentQuestions;
              }

              return [...currentQuestions, body.createdQuestion!].sort(
                (first, second) => first.orderIndex - second.orderIndex,
              );
            });
          }
        } else {
          const reason = body.reason ?? "unknown";
          devLog("[dynamic-followup:client] skipped", {
            sessionId,
            reason,
            retryCount: dynamicFollowupRetryCountRef.current,
          });

          if (body.skipped && isTranscriptNotReadyReason(reason)) {
            scheduleDynamicFollowupRetry(reason);
            return;
          }

          dynamicFollowupCompletedRef.current = true;
          clearDynamicFollowupRetryTimer();
        }
      } catch (error) {
        devLog("[dynamic-followup:client] error", {
          sessionId,
          error: String(error),
          retryCount: dynamicFollowupRetryCountRef.current,
        });
        scheduleDynamicFollowupRetry("network_error");
      } finally {
        dynamicFollowupInFlightRef.current = false;
      }
    })();
  }, [
    clearDynamicFollowupRetryTimer,
    dynamicFollowupExperiment,
    dynamicFollowupRetryTick,
    isGuardResolved,
    qaPhase,
    questions,
    scheduleDynamicFollowupRetry,
    sessionId,
    setQuestions,
  ]);

  // 自动生成 QA 问题：轮询 GET → POST 一次 → 等待 → 超时
  useEffect(() => {
    if (!isGuardResolved) return;
    if (questions.length > 0) {
      devLog("[qa:client] questions already loaded, skipping auto-generate", {
        count: questions.length,
      });
      return;
    }
    if (autoGenerateRef.current) return;
    autoGenerateRef.current = true;

    devLog("[qa:client] starting auto-generation", {
      sessionId,
      initialQuestionsCount: 0,
    });

    const startTime = Date.now();
    const MAX_WAIT_MS = dynamicFollowupExperiment ? 120_000 : 60_000;
    const POLL_INTERVAL_MS = 3_000;
    let pollTimer: ReturnType<typeof setInterval> | null = null;
    let postAttempted = false;
    let aborted = false;

    setIsGenerating(true);

    const stop = (errorMsg?: string) => {
      aborted = true;
      if (pollTimer !== null) {
        clearInterval(pollTimer);
        pollTimer = null;
      }
      if (errorMsg) {
        setMessage(errorMsg);
      }
      setIsGenerating(false);
    };

    const poll = async () => {
      if (aborted) return;
      const elapsed = Date.now() - startTime;

      // 硬超时 60 秒
      if (elapsed >= MAX_WAIT_MS) {
        devLog("[qa:client] generation timed out", {
          sessionId,
          elapsed: `${Math.round(elapsed / 1000)}s`,
        });
        stop("问题生成时间较长，可重试。");
        return;
      }

      try {
        // 步骤 1: GET 检查当前状态
        const getRes = await fetch(
          `/training/${sessionId}/qa/questions/generate`,
        );
        const getBody = (await getRes.json().catch(() => null)) as {
          questions?: QaGenerationQuestion[];
          isGenerating?: boolean;
          error?: string;
        } | null;

        devLog("[qa:client] GET response", {
          sessionId,
          elapsed: `${Math.round((Date.now() - startTime) / 1000)}s`,
          questionsCount: getBody?.questions?.length ?? 0,
          isGenerating: getBody?.isGenerating ?? false,
          error: getBody?.error ?? null,
        });

        // 已有问题 → 直接展示
        if (getBody?.questions?.length) {
          devLog("[qa:client] questions found, displaying", {
            count: getBody.questions.length,
          });
          setQuestions(getBody.questions);
          setCurrentQuestionIndex(0);
          setMessage("答辩问题已生成。开始前不会展示完整题目。");
          stop();
          return;
        }

        // 正在生成 → 继续等待
        if (getBody?.isGenerating) {
          // 已达 30 秒提示用户
          if (elapsed >= 30_000) {
            setMessage("评委问题生成时间较长，请稍候……");
          }
          return;
        }

        // 步骤 2: 没有 questions 且不在生成中 → 首次尝试 POST
        if (!postAttempted) {
          postAttempted = true;

          devLog("[qa:client] POST generating questions", { sessionId });
          const postRes = await fetch(
            `/training/${sessionId}/qa/questions/generate`,
            { method: "POST" },
          );
          const postBody = (await postRes.json().catch(() => null)) as {
            questions?: QaGenerationQuestion[];
            error?: string;
            generating?: boolean;
            lockAgeMs?: number;
            message?: string;
          } | null;

          devLog("[qa:client] POST response", {
            sessionId,
            status: postRes.status,
            ok: postRes.ok,
            questionsCount: postBody?.questions?.length ?? 0,
            generating: postBody?.generating ?? false,
            error: postBody?.error ?? null,
          });

          // POST 成功
          if (postRes.ok && postBody?.questions?.length) {
            setQuestions(postBody.questions);
            setCurrentQuestionIndex(0);
            setMessage("答辩问题已生成。开始前不会展示完整题目。");
            stop();
            return;
          }

          // POST 409: 正在生成中（锁存在），切换到轮询等待
          if (postRes.status === 409) {
            setMessage(
              postBody?.message ?? "评委问题准备中，请稍候……",
            );
            return;
          }

          // POST 其他错误: 显示错误并停止
          stop(postBody?.error ?? "问题生成失败，请重试。");
          return;
        }
      } catch {
        // 网络错误，继续轮询（可能是暂时的）
        devLog("[qa:client] network error during poll, will retry", {
          sessionId,
        });
      }
    };

    // 首次立即轮询
    poll();
    pollTimer = setInterval(poll, POLL_INTERVAL_MS);

    return () => {
      aborted = true;
      if (pollTimer !== null) {
        clearInterval(pollTimer);
      }
    };
  }, [
    dynamicFollowupExperiment,
    isGuardResolved,
    questions.length,
    sessionId,
    setCurrentQuestionIndex,
    setMessage,
    setQuestions,
  ]);

  return { isGenerating };
}
