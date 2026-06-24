"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { devLog } from "@/lib/dev-log";

type TrainingTranscript = {
  id: string;
  recordingId: string;
  sessionId: string;
  status: string;
  source: string;
  language: string;
  text: string;
  segmentsJson: string | null;
  errorMessage: string | null;
  startedAt: string | null;
  completedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

type QaPrepareClientProps = Readonly<{
  sessionId: string;
  projectName: string;
  recordingId: string | null;
}>;

const pollIntervalMs = 3_000;
const prepareDurationMs = 13_000;

function isTranscriptNotReadyReason(reason: string | undefined) {
  return reason === "pitch_transcript_not_ready";
}

export function QaPrepareClient({
  sessionId,
  projectName,
  recordingId,
}: QaPrepareClientProps) {
  const router = useRouter();
  const [message, setMessage] = useState(
    "正在整理评委问题。",
  );
  const [detail, setDetail] = useState(
    "系统正在完成答辩前准备，即将进入正式答辩。",
  );
  const navigationStartedRef = useRef(false);
  const navigationTimerRef = useRef<number | null>(null);

  const enterQa = useCallback((nextMessage?: string) => {
    if (navigationStartedRef.current) {
      return;
    }

    navigationStartedRef.current = true;
    setMessage(nextMessage ?? "准备完成，正在进入答辩。");
    setDetail("即将进入正式答辩。");

    navigationTimerRef.current = window.setTimeout(() => {
      navigationTimerRef.current = null;
      router.replace(`/training/${sessionId}/qa`);
    }, 900);
  }, [router, sessionId]);

  useEffect(() => {
    let cancelled = false;
    let transitionTimer: ReturnType<typeof setTimeout> | null = null;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;

    const clearRetryTimer = () => {
      if (retryTimer !== null) {
        clearTimeout(retryTimer);
        retryTimer = null;
      }
    };

    const schedule = (callback: () => void) => {
      clearRetryTimer();
      retryTimer = setTimeout(callback, pollIntervalMs);
    };

    const safeEnterQa = (nextMessage?: string) => {
      if (cancelled) {
        return;
      }

      enterQa(nextMessage);
    };

    const runDynamicFollowup = async () => {
      if (cancelled) {
        return;
      }

      setMessage("正在整理评委问题。");
      setDetail("系统正在完成答辩前准备，即将进入正式答辩。");

      try {
        const response = await fetch(
          `/training/${sessionId}/qa/questions/dynamic-followup`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              protectedQuestionIds: [],
              minReplaceableOrderIndex: 1,
            }),
          },
        );
        const body = (await response.json().catch(() => null)) as {
          ok?: boolean;
          skipped?: boolean;
          reason?: string;
          createdQuestion?: unknown;
          createdQuestionId?: string;
        } | null;

        devLog("[qa-prepare:dynamic-followup] response", {
          sessionId,
          status: response.status,
          ok: response.ok,
          bodyOk: body?.ok,
          skipped: body?.skipped,
          reason: body?.reason,
          createdQuestionId: body?.createdQuestionId,
        });

        if (!response.ok) {
          return;
        }

        if (body?.ok && body.createdQuestion) {
          safeEnterQa("已生成本轮动态追问，正在进入答辩。");
          return;
        }

        if (body?.skipped && isTranscriptNotReadyReason(body.reason)) {
          schedule(() => {
            void runDynamicFollowup();
          });
          return;
        }
      } catch {
        schedule(() => {
          void runDynamicFollowup();
        });
      }
    };

    const startTranscriptionIfNeeded = async () => {
      if (!recordingId || cancelled) {
        return;
      }

      try {
        const response = await fetch(
          `/training/${sessionId}/recordings/${recordingId}/transcript`,
        );
        const body = (await response.json().catch(() => null)) as {
          transcript?: TrainingTranscript | null;
          error?: string;
        } | null;

        if (!response.ok) {
          throw new Error(body?.error ?? "transcript_status_unavailable");
        }

        const transcript = body?.transcript ?? null;

        if (
          transcript?.status === "COMPLETED" ||
          transcript?.status === "FAILED" ||
          transcript?.status === "PENDING" ||
          transcript?.status === "PROCESSING"
        ) {
          return;
        }
      } catch {
        // 状态查询不可用时继续走启动确认接口，由服务端做幂等保护。
      }

      try {
        await fetch(
          `/training/${sessionId}/recordings/${recordingId}/transcribe/start`,
          { method: "POST" },
        );
      } catch {
        // 转写启动结果不影响进入正式答辩。
      }
    };

    navigationStartedRef.current = false;

    transitionTimer = setTimeout(() => {
      safeEnterQa("答辩问题已准备完成。");
    }, prepareDurationMs);

    void startTranscriptionIfNeeded();
    void runDynamicFollowup();

    return () => {
      cancelled = true;
      clearRetryTimer();
      if (transitionTimer !== null) {
        clearTimeout(transitionTimer);
      }
      if (navigationTimerRef.current !== null) {
        clearTimeout(navigationTimerRef.current);
        navigationTimerRef.current = null;
      }
    };
  }, [enterQa, recordingId, sessionId]);

  return (
    <div className="grid min-h-screen place-items-center px-6 py-10">
      <section className="w-full max-w-xl text-center">
        <span className="inline-block rounded-full border border-slate-700 bg-slate-900 px-3 py-1 text-xs font-medium text-slate-400">
          模拟答辩
        </span>
        <h1 className="mt-6 text-3xl font-semibold text-white">答辩准备中</h1>
        <p className="mt-3 text-sm font-medium text-slate-300">{projectName}</p>
        <p className="mt-6 text-base leading-7 text-slate-200">{message}</p>
        <p className="mt-3 text-sm leading-6 text-slate-400">{detail}</p>

        <div className="mx-auto mt-8 flex h-12 w-28 items-center justify-center gap-2">
          <span className="h-2.5 w-2.5 animate-pulse rounded-full bg-white/70" />
          <span
            className="h-2.5 w-2.5 animate-pulse rounded-full bg-white/70"
            style={{ animationDelay: "180ms" }}
          />
          <span
            className="h-2.5 w-2.5 animate-pulse rounded-full bg-white/70"
            style={{ animationDelay: "360ms" }}
          />
        </div>

        <div className="mx-auto mt-6 h-2 w-full max-w-md overflow-hidden rounded-full bg-slate-800">
          <div className="h-full w-2/3 animate-[qaPrepareBar_1.8s_ease-in-out_infinite] rounded-full bg-gradient-to-r from-blue-500 via-cyan-300 to-white" />
        </div>

      </section>

      <style jsx>{`
        @keyframes qaPrepareBar {
          0% {
            transform: translateX(-120%);
          }
          55% {
            transform: translateX(30%);
          }
          100% {
            transform: translateX(170%);
          }
        }
      `}</style>
    </div>
  );
}
