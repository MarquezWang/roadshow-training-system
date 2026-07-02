"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useTrainingAbortGuard } from "@/lib/use-training-abort-guard";

type UseQaPageGuardsParams = Readonly<{
  sessionId: string;
  initialStatus: string;
  status: string;
  isCompletingNormallyRef: { current: boolean };
}>;

export function useQaPageGuards({
  sessionId,
  initialStatus,
  status,
  isCompletingNormallyRef,
}: UseQaPageGuardsParams) {
  const router = useRouter();
  const [isGuardResolved, setIsGuardResolved] = useState(false);

  useTrainingAbortGuard({
    sessionId,
    enabled: status === "QA_READY" || status === "QAING",
    isCompletingNormallyRef,
    onPendingAbortDetected: () => {
      void (async () => {
        try {
          await fetch(`/training/${sessionId}/abort`, { method: "POST" });
        } finally {
          router.replace(`/training/${sessionId}/report`);
        }
      })();
    },
  });

  useEffect(() => {
    const isActiveStatus =
      initialStatus === "QAING" || initialStatus === "QA_READY";
    if (!isActiveStatus) {
      queueMicrotask(() => setIsGuardResolved(true));
      return;
    }
    const key = `training:${sessionId}:pending-abort`;
    const hasPending = sessionStorage.getItem(key);
    if (hasPending) {
      sessionStorage.removeItem(key);
      void (async () => {
        try {
          await fetch(`/training/${sessionId}/abort`, { method: "POST" });
        } finally {
          router.replace(`/training/${sessionId}/report`);
        }
      })();
      return;
    }
    queueMicrotask(() => setIsGuardResolved(true));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const header = document.querySelector("header");
    if (!header) return;
    const originalDisplay = header.style.display;
    header.style.display = "none";
    return () => {
      header.style.display = originalDisplay;
    };
  }, []);

  // 鎷︽埅娴忚鍣ㄨ繑鍥烇細push 鍝ㄥ叺鐘舵€侊紝杩斿洖鏃舵寜涓璁粌澶勭悊
  useEffect(() => {
    const sentinelKey = `qa-sentinel-${sessionId}`;
    let aborted = false;

    const handleAbort = () => {
      if (aborted || isCompletingNormallyRef.current) return;
      aborted = true;
      void (async () => {
        try {
          await fetch(`/training/${sessionId}/abort`, { method: "POST" });
        } finally {
          router.replace(`/training/${sessionId}/report`);
        }
      })();
    };

    const handlePopState = () => {
      handleAbort();
    };

    history.pushState({ [sentinelKey]: true }, "", window.location.href);
    window.addEventListener("popstate", handlePopState);

    return () => {
      window.removeEventListener("popstate", handlePopState);
    };
  }, [sessionId, router, isCompletingNormallyRef]);

  useEffect(() => {
    const originalOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = originalOverflow;
    };
  }, []);

  return { isGuardResolved };
}
