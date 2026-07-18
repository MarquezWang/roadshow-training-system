"use client";

import { useEffect, useRef, useState } from "react";
import { devLog } from "@/lib/dev-log";
import {
  getQaGenerationMaxWaitMs,
  QA_GENERATION_POLL_INTERVAL_MS,
  QA_GENERATION_WAIT_HINT_MS,
} from "./policy";
import type {
  QaGenerationQuestion,
  UseBaseQaQuestionGenerationOptions,
} from "./types";

type GetGenerationResponse = {
  questions?: QaGenerationQuestion[];
  isGenerating?: boolean;
  error?: string;
};

type PostGenerationResponse = {
  questions?: QaGenerationQuestion[];
  error?: string;
  generating?: boolean;
  lockAgeMs?: number;
  message?: string;
};

export function useBaseQaQuestionGeneration({
  sessionId,
  dynamicFollowupExperiment,
  isGuardResolved,
  questions,
  setQuestions,
  setCurrentQuestionIndex,
  setMessage,
}: UseBaseQaQuestionGenerationOptions) {
  const [isGenerating, setIsGenerating] = useState(false);
  const autoGenerateRef = useRef(false);

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
    const maxWaitMs = getQaGenerationMaxWaitMs(dynamicFollowupExperiment);
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

      if (elapsed >= maxWaitMs) {
        devLog("[qa:client] generation timed out", {
          sessionId,
          elapsed: `${Math.round(elapsed / 1000)}s`,
        });
        stop("问题生成时间较长，可重试。");
        return;
      }

      try {
        const getRes = await fetch(
          `/training/${sessionId}/qa/questions/generate`,
        );
        const getBody = (await getRes.json().catch(() => null)) as
          | GetGenerationResponse
          | null;

        devLog("[qa:client] GET response", {
          sessionId,
          elapsed: `${Math.round((Date.now() - startTime) / 1000)}s`,
          questionsCount: getBody?.questions?.length ?? 0,
          isGenerating: getBody?.isGenerating ?? false,
          error: getBody?.error ?? null,
        });

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

        if (getBody?.isGenerating) {
          if (elapsed >= QA_GENERATION_WAIT_HINT_MS) {
            setMessage("评委问题生成时间较长，请稍候……");
          }
          return;
        }

        if (!postAttempted) {
          postAttempted = true;

          devLog("[qa:client] POST generating questions", { sessionId });
          const postRes = await fetch(
            `/training/${sessionId}/qa/questions/generate`,
            { method: "POST" },
          );
          const postBody = (await postRes.json().catch(() => null)) as
            | PostGenerationResponse
            | null;

          devLog("[qa:client] POST response", {
            sessionId,
            status: postRes.status,
            ok: postRes.ok,
            questionsCount: postBody?.questions?.length ?? 0,
            generating: postBody?.generating ?? false,
            error: postBody?.error ?? null,
          });

          if (postRes.ok && postBody?.questions?.length) {
            setQuestions(postBody.questions);
            setCurrentQuestionIndex(0);
            setMessage("答辩问题已生成。开始前不会展示完整题目。");
            stop();
            return;
          }

          if (postRes.status === 409) {
            setMessage(postBody?.message ?? "评委问题准备中，请稍候……");
            return;
          }

          stop(postBody?.error ?? "问题生成失败，请重试。");
          return;
        }
      } catch {
        devLog("[qa:client] network error during poll, will retry", {
          sessionId,
        });
      }
    };

    void poll();
    pollTimer = setInterval(() => void poll(), QA_GENERATION_POLL_INTERVAL_MS);

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
