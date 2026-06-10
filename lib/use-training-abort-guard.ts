"use client";

import { useEffect, type MutableRefObject } from "react";

const abortWarningMessage =
  "离开页面将导致本轮训练中止，已完成内容会保留，但无法继续本轮训练。";

function sendAbortRequest(sessionId: string) {
  const abortUrl = `/training/${sessionId}/abort`;

  try {
    if (navigator.sendBeacon) {
      const blob = new Blob(["{}"], { type: "application/json" });

      navigator.sendBeacon(abortUrl, blob);
    }
  } catch {
    // sendBeacon is best effort; keepalive fetch below covers common browsers.
  }

  void fetch(abortUrl, {
    method: "POST",
    keepalive: true,
  }).catch(() => {
    // Abort is best effort during unload. The pending local flag is checked on next mount.
  });
}

type TrainingAbortGuardOptions = Readonly<{
  sessionId: string;
  enabled: boolean;
  isCompletingNormallyRef: MutableRefObject<boolean>;
}>;

export function useTrainingAbortGuard({
  sessionId,
  enabled,
  isCompletingNormallyRef,
}: TrainingAbortGuardOptions) {
  useEffect(() => {
    if (!enabled) {
      return;
    }

    let shouldAbortOnPageHide = false;

    const abortTraining = () => {
      if (isCompletingNormallyRef.current) {
        return;
      }

      sendAbortRequest(sessionId);
    };

    const handleBeforeUnload = (event: BeforeUnloadEvent) => {
      if (isCompletingNormallyRef.current) {
        return;
      }

      shouldAbortOnPageHide = true;
      event.preventDefault();
      event.returnValue = abortWarningMessage;
    };

    const handlePageHide = () => {
      if (!shouldAbortOnPageHide || isCompletingNormallyRef.current) {
        return;
      }

      abortTraining();
    };

    const handleDocumentClick = (event: MouseEvent) => {
      if (isCompletingNormallyRef.current || event.defaultPrevented) {
        return;
      }

      const target = event.target;

      if (!(target instanceof Element)) {
        return;
      }

      const anchor = target.closest("a[href]");

      if (!(anchor instanceof HTMLAnchorElement)) {
        return;
      }

      if (
        anchor.target &&
        anchor.target.toLowerCase() !== "_self" &&
        anchor.target.trim() !== ""
      ) {
        return;
      }

      if (anchor.hasAttribute("download")) {
        return;
      }

      const nextUrl = new URL(anchor.href, window.location.href);

      if (nextUrl.href === window.location.href) {
        return;
      }

      if (
        nextUrl.origin === window.location.origin &&
        nextUrl.pathname.startsWith(`/training/${sessionId}`)
      ) {
        return;
      }

      event.preventDefault();

      if (!window.confirm(abortWarningMessage)) {
        return;
      }

      abortTraining();
      isCompletingNormallyRef.current = true;
      window.location.assign(nextUrl.href);
    };

    window.addEventListener("beforeunload", handleBeforeUnload);
    window.addEventListener("pagehide", handlePageHide);
    document.addEventListener("click", handleDocumentClick, true);

    return () => {
      window.removeEventListener("beforeunload", handleBeforeUnload);
      window.removeEventListener("pagehide", handlePageHide);
      document.removeEventListener("click", handleDocumentClick, true);
    };
  }, [enabled, isCompletingNormallyRef, sessionId]);
}
