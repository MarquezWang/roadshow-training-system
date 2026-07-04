"use client";

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";

type UseReportAbortTranscriptPollingOptions = Readonly<{
  sessionId: string;
  isAborted: boolean;
}>;

export function useReportAbortTranscriptPolling({
  sessionId,
  isAborted,
}: UseReportAbortTranscriptPollingOptions) {
  const router = useRouter();
  const abortPollTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // 中止报告：轻量轮询 transcript 状态，直到全部稳定
  useEffect(() => {
    if (!isAborted) return;

    const pollAbortTranscripts = async () => {
      try {
        const res = await fetch(
          `/training/${sessionId}/report/status`,
          { cache: "no-store" },
        );
        const status = (await res.json().catch(() => null)) as {
          pitchTranscriptStatus?: string;
          qaTranscriptItems?: Array<{
            recordingId: string;
            transcriptStatus: string;
          }>;
        } | null;

        if (!status) return;

        const pitchUnstable =
          status.pitchTranscriptStatus === "PENDING" ||
          status.pitchTranscriptStatus === "PROCESSING";
        const items = status.qaTranscriptItems ?? [];
        const hasUnstableQa = items.some(
          (item) =>
            item.transcriptStatus === "PENDING" ||
            item.transcriptStatus === "PROCESSING",
        );

        if (pitchUnstable || hasUnstableQa) {
          router.refresh();
          return;
        }

        // 全部稳定，停止轮询
        if (abortPollTimerRef.current) {
          clearInterval(abortPollTimerRef.current);
          abortPollTimerRef.current = null;
        }
      } catch {
        // 忽略轮询网络错误
      }
    };

    void pollAbortTranscripts();
    abortPollTimerRef.current = setInterval(() => {
      void pollAbortTranscripts();
    }, 4000);

    return () => {
      if (abortPollTimerRef.current) {
        clearInterval(abortPollTimerRef.current);
        abortPollTimerRef.current = null;
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAborted, sessionId]);
}
