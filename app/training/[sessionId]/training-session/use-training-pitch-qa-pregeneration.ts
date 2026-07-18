"use client";

import { useEffect, useRef } from "react";
import { devLog, devWarn } from "@/lib/dev-log";

type UseTrainingPitchQaPregenerationOptions = Readonly<{
  isGuardResolved: boolean;
  isPitching: boolean;
  sessionId: string;
}>;

export function useTrainingPitchQaPregeneration({
  isGuardResolved,
  isPitching,
  sessionId,
}: UseTrainingPitchQaPregenerationOptions) {
  const hasTriggeredRef = useRef(false);

  useEffect(() => {
    if (!isPitching || !isGuardResolved || hasTriggeredRef.current) {
      return;
    }

    hasTriggeredRef.current = true;
    devLog("[pitch:mounted] pre-generate QA fallback started", {
      sessionId,
    });

    void (async () => {
      try {
        const getResponse = await fetch(
          `/training/${sessionId}/qa/questions/generate`,
        );
        const getBody = (await getResponse.json().catch(() => null)) as {
          questions?: Array<unknown>;
          isGenerating?: boolean;
        } | null;

        if (getBody?.questions?.length) {
          devLog("[pitch:mounted] QA questions already exist", {
            sessionId,
            count: getBody.questions.length,
          });
          return;
        }

        if (getBody?.isGenerating) {
          devLog("[pitch:mounted] QA generation already in progress", {
            sessionId,
          });
          return;
        }

        const postResponse = await fetch(
          `/training/${sessionId}/qa/questions/generate`,
          {
            method: "POST",
            keepalive: true,
          },
        );
        const postBody = (await postResponse.json().catch(() => null)) as {
          error?: string;
          generating?: boolean;
          questions?: Array<unknown>;
        } | null;

        devLog("[pitch:mounted] pre-generate QA fallback response", {
          sessionId,
          status: postResponse.status,
          ok: postResponse.ok,
          questionsCount: postBody?.questions?.length ?? 0,
          generating: postBody?.generating ?? false,
          error: postBody?.error ?? null,
        });
      } catch (error) {
        devWarn("[pitch:mounted] pre-generate QA fallback failed", {
          sessionId,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    })();
  }, [isGuardResolved, isPitching, sessionId]);
}
