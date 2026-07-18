"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import type { MutableRefObject } from "react";
import { getTrainingFlowPath } from "@/lib/training-status";
import { useTrainingAbortGuard } from "@/lib/use-training-abort-guard";

type UseTrainingPitchPageGuardsOptions = Readonly<{
  initialStatus: string;
  isCompletingNormallyRef: MutableRefObject<boolean>;
  isPitching: boolean;
  sessionId: string;
}>;

export function useTrainingPitchPageGuards({
  initialStatus,
  isCompletingNormallyRef,
  isPitching,
  sessionId,
}: UseTrainingPitchPageGuardsOptions) {
  const router = useRouter();
  const [isGuardResolved, setIsGuardResolved] = useState(false);
  const abortAndNavigateToReport = useCallback(() => {
    void (async () => {
      try {
        await fetch(`/training/${sessionId}/abort`, { method: "POST" });
      } finally {
        router.replace(`/training/${sessionId}/report`);
      }
    })();
  }, [router, sessionId]);

  useTrainingAbortGuard({
    sessionId,
    enabled: isPitching,
    isCompletingNormallyRef,
    onPendingAbortDetected: abortAndNavigateToReport,
  });

  // BFCache 恢复 / 页面重新可见时校验状态，若已不在 pitch 阶段则跳转。
  useEffect(() => {
    async function verifyStatus() {
      try {
        const response = await fetch(`/training/${sessionId}/status`);

        if (!response.ok) {
          return;
        }

        const body = (await response.json()) as { status?: string };

        if (!body.status || body.status === "PITCHING") {
          return;
        }

        isCompletingNormallyRef.current = true;
        router.replace(getTrainingFlowPath(sessionId, body.status));
      } catch {
        // 网络错误时不跳转，避免误伤正常训练。
      }
    }

    const handlePageShow = (event: PageTransitionEvent) => {
      if (event.persisted) {
        void verifyStatus();
      }
    };
    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        void verifyStatus();
      }
    };

    window.addEventListener("pageshow", handlePageShow);
    document.addEventListener("visibilitychange", handleVisibilityChange);

    return () => {
      window.removeEventListener("pageshow", handlePageShow);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [isCompletingNormallyRef, router, sessionId]);

  // 拦截浏览器返回：pitch 阶段 push 哨兵，返回时按中止训练处理。
  useEffect(() => {
    if (!isPitching) {
      return;
    }

    const sentinelKey = `pitch-sentinel-${sessionId}`;
    let aborted = false;
    const handleAbort = () => {
      if (aborted || isCompletingNormallyRef.current) {
        return;
      }

      aborted = true;
      abortAndNavigateToReport();
    };

    history.pushState({ [sentinelKey]: true }, "", window.location.href);
    window.addEventListener("popstate", handleAbort);

    return () => {
      window.removeEventListener("popstate", handleAbort);
    };
  }, [
    abortAndNavigateToReport,
    isCompletingNormallyRef,
    isPitching,
    sessionId,
  ]);

  useEffect(() => {
    if (initialStatus !== "PITCHING") {
      queueMicrotask(() => setIsGuardResolved(true));
      return;
    }

    const key = `training:${sessionId}:pending-abort`;
    const hasPending = sessionStorage.getItem(key);

    if (hasPending) {
      sessionStorage.removeItem(key);
      abortAndNavigateToReport();
      return;
    }

    queueMicrotask(() => setIsGuardResolved(true));
    // This guard intentionally resolves only from the initial route snapshot.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return { isGuardResolved };
}
