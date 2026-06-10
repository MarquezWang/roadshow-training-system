"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

type TrainingFile = {
  id: string;
  originalName: string;
  fileType: string;
};

type TrainingSessionClientProps = Readonly<{
  sessionId: string;
  initialStatus: string;
  initialPageIndex: number;
  initialPitchStartedAt: string | null;
  initialElapsedSec: number;
  initialRemainingSec: number;
  initialPitchDurationSec: number | null;
  files: TrainingFile[];
}>;

const pitchLimitSec = 9 * 60;

function formatDuration(totalSec: number) {
  const minutes = Math.floor(totalSec / 60)
    .toString()
    .padStart(2, "0");
  const seconds = (totalSec % 60).toString().padStart(2, "0");

  return `${minutes}:${seconds}`;
}

function getElapsedSec(startedAt: string | null, fallback: number) {
  if (!startedAt) {
    return fallback;
  }

  return Math.max(
    0,
    Math.floor((Date.now() - new Date(startedAt).getTime()) / 1000),
  );
}

export function TrainingSessionClient({
  sessionId,
  initialStatus,
  initialPageIndex,
  initialPitchStartedAt,
  initialElapsedSec,
  initialRemainingSec,
  initialPitchDurationSec,
  files,
}: TrainingSessionClientProps) {
  const [status, setStatus] = useState(initialStatus);
  const [pageIndex, setPageIndex] = useState(initialPageIndex);
  const [pitchStartedAt, setPitchStartedAt] = useState(initialPitchStartedAt);
  const [elapsedSec, setElapsedSec] = useState(
    initialPitchDurationSec ?? initialElapsedSec,
  );
  const [remainingSec, setRemainingSec] = useState(initialRemainingSec);
  const [message, setMessage] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const isPitching = status === "PITCHING";
  const isEnded = status === "PITCH_ENDED" || status === "FINISHED";
  const primaryFileId = files[0]?.id ?? null;
  const statusLabel = useMemo(() => {
    const labels: Record<string, string> = {
      CREATED: "待开始",
      PITCHING: "路演中",
      PITCH_ENDED: "路演已结束",
      QA_READY: "问答准备中",
      FINISHED: "已完成",
    };

    return labels[status] ?? status;
  }, [status]);

  useEffect(() => {
    if (!isPitching) {
      return;
    }

    const updateTimer = () => {
      const nextElapsedSec = getElapsedSec(pitchStartedAt, 0);

      setElapsedSec(nextElapsedSec);
      setRemainingSec(Math.max(0, pitchLimitSec - nextElapsedSec));
    };

    updateTimer();

    const timer = window.setInterval(() => {
      updateTimer();
    }, 1000);

    return () => window.clearInterval(timer);
  }, [isPitching, pitchStartedAt]);

  const recordSlideEvent = useCallback(
    async (eventType: "NEXT" | "PREV" | "JUMP", nextPageIndex: number) => {
      const response = await fetch(`/training/${sessionId}/events`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          eventType,
          pageIndex: nextPageIndex,
          elapsedSec,
          fileId: primaryFileId,
        }),
      });

      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as {
          error?: string;
        } | null;

        throw new Error(body?.error ?? "翻页事件记录失败。");
      }

    },
    [elapsedSec, primaryFileId, sessionId],
  );

  const changePage = useCallback(
    async (direction: "NEXT" | "PREV") => {
      if (!isPitching || isSubmitting) {
        return;
      }

      const nextPageIndex =
        direction === "NEXT" ? pageIndex + 1 : Math.max(0, pageIndex - 1);

      if (nextPageIndex === pageIndex) {
        return;
      }

      setIsSubmitting(true);
      setMessage("");

      try {
        await recordSlideEvent(direction, nextPageIndex);
        setPageIndex(nextPageIndex);
      } catch (error) {
        setMessage(error instanceof Error ? error.message : "翻页失败。");
      } finally {
        setIsSubmitting(false);
      }
    },
    [isPitching, isSubmitting, pageIndex, recordSlideEvent],
  );

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "ArrowLeft") {
        event.preventDefault();
        void changePage("PREV");
      }

      if (event.key === "ArrowRight") {
        event.preventDefault();
        void changePage("NEXT");
      }
    };

    window.addEventListener("keydown", handleKeyDown);

    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [changePage]);

  async function startPitch() {
    setIsSubmitting(true);
    setMessage("");

    try {
      const response = await fetch(`/training/${sessionId}/start-pitch`, {
        method: "POST",
      });

      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as {
          error?: string;
        } | null;

        throw new Error(body?.error ?? "开始路演失败。");
      }

      const body = (await response.json()) as {
        session: {
          status: string;
          pitchStartedAt: string;
        };
      };

      setStatus(body.session.status);
      setPitchStartedAt(body.session.pitchStartedAt);
      setElapsedSec(0);
      setRemainingSec(pitchLimitSec);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "开始路演失败。");
    } finally {
      setIsSubmitting(false);
    }
  }

  async function endPitch() {
    setIsSubmitting(true);
    setMessage("");

    try {
      const response = await fetch(`/training/${sessionId}/end-pitch`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          pitchDurationSec: elapsedSec,
        }),
      });

      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as {
          error?: string;
        } | null;

        throw new Error(body?.error ?? "结束路演失败。");
      }

      const body = (await response.json()) as {
        session: {
          status: string;
          pitchDurationSec: number;
        };
      };

      setStatus(body.session.status);
      setElapsedSec(body.session.pitchDurationSec);
      setRemainingSec(
        Math.max(0, pitchLimitSec - body.session.pitchDurationSec),
      );
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "结束路演失败。");
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
      <section className="rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
        <div className="flex flex-col gap-4 border-b border-slate-200 pb-5 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <p className="text-xs font-medium text-slate-500">训练状态</p>
            <h2 className="mt-2 text-xl font-semibold text-slate-950">
              {statusLabel}
            </h2>
          </div>
          <div className="text-left sm:text-right">
            <p className="text-xs font-medium text-slate-500">9 分钟倒计时</p>
            <p
              className={
                remainingSec <= 60
                  ? "mt-2 text-4xl font-semibold text-red-700"
                  : "mt-2 text-4xl font-semibold text-slate-950"
              }
            >
              {formatDuration(remainingSec)}
            </p>
          </div>
        </div>

        {message ? (
          <p className="mt-5 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
            {message}
          </p>
        ) : null}

        <div className="mt-5 grid min-h-80 place-items-center rounded-lg border border-dashed border-slate-300 bg-slate-50 p-8 text-center">
          <div>
            <p className="text-sm font-medium text-slate-500">材料展示占位</p>
            <p className="mt-4 text-6xl font-semibold text-slate-950">
              {pageIndex + 1}
            </p>
            <p className="mt-3 text-sm text-slate-600">当前页码</p>
          </div>
        </div>

        <div className="mt-5 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={startPitch}
              disabled={isPitching || isEnded || isSubmitting}
              className="inline-flex h-10 items-center justify-center rounded-md bg-slate-950 px-4 text-sm font-medium text-white transition-colors hover:bg-slate-800 disabled:cursor-not-allowed disabled:bg-slate-300"
            >
              开始路演
            </button>
            <button
              type="button"
              onClick={endPitch}
              disabled={!isPitching || isSubmitting}
              className="inline-flex h-10 items-center justify-center rounded-md border border-red-200 bg-red-50 px-4 text-sm font-medium text-red-700 transition-colors hover:bg-red-100 disabled:cursor-not-allowed disabled:border-slate-200 disabled:bg-slate-100 disabled:text-slate-400"
            >
              结束路演
            </button>
          </div>

          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => void changePage("PREV")}
              disabled={!isPitching || pageIndex === 0 || isSubmitting}
              className="inline-flex h-10 items-center justify-center rounded-md border border-slate-300 bg-white px-4 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-50 disabled:cursor-not-allowed disabled:bg-slate-100 disabled:text-slate-400"
            >
              上一页
            </button>
            <button
              type="button"
              onClick={() => void changePage("NEXT")}
              disabled={!isPitching || isSubmitting}
              className="inline-flex h-10 items-center justify-center rounded-md border border-slate-300 bg-white px-4 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-50 disabled:cursor-not-allowed disabled:bg-slate-100 disabled:text-slate-400"
            >
              下一页
            </button>
          </div>
        </div>
      </section>

      <aside className="grid gap-4">
        <section className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
          <h2 className="text-base font-semibold text-slate-950">路演信息</h2>
          <dl className="mt-4 grid gap-3 text-sm">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <dt className="text-slate-500">路演用时</dt>
              <dd className="font-medium text-slate-950">
                {formatDuration(elapsedSec)}
              </dd>
            </div>
            <div className="flex items-center justify-between">
              <dt className="text-slate-500">当前页码</dt>
              <dd className="font-medium text-slate-950">{pageIndex + 1}</dd>
            </div>
          </dl>
        </section>

        <section className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
          <h2 className="text-base font-semibold text-slate-950">
            纳入 AI 上下文的文件
          </h2>
          {files.length > 0 ? (
            <ul className="mt-4 grid gap-3">
              {files.map((file) => (
                <li
                  key={file.id}
                  className="rounded-md border border-slate-200 bg-slate-50 p-3"
                >
                  <p className="break-words text-sm font-medium text-slate-900">
                    {file.originalName}
                  </p>
                  <p className="mt-1 text-xs uppercase text-slate-500">
                    {file.fileType}
                  </p>
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-4 rounded-md border border-dashed border-slate-300 p-4 text-sm leading-6 text-slate-600">
              暂无已解析且纳入 AI 上下文的文件。
            </p>
          )}
        </section>
      </aside>
    </div>
  );
}
