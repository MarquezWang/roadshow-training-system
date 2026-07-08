"use client";

import type { ReportScoreDisplayState } from "./report-score-display";

type OverviewAnalysis = {
  overallScore: number | null;
  summary: string;
};

type OnePageSummary = {
  conclusion: string;
  strongestPoint: string;
  biggestWeakness: string;
  nextTrainingFocus: string;
  readinessAdvice: string;
};

type ReportOverviewSummaryProps = Readonly<{
  analysis: OverviewAnalysis;
  onePageSummary: OnePageSummary;
  scoreDisplay: ReportScoreDisplayState;
  copySummaryMessage: string;
  onCopyOnePageSummary: () => void;
}>;

type ScoreTone = Readonly<{
  label: string;
  textClassName: string;
  borderClassName: string;
  gaugeColor: string;
}>;

function clampScore(score: number | null) {
  if (score === null) {
    return 0;
  }

  return Math.min(100, Math.max(0, score));
}

function getScoreTone(score: number | null): ScoreTone {
  if (score === null) {
    return {
      label: "暂无评分",
      textClassName: "text-slate-300",
      borderClassName: "border-slate-500/40",
      gaugeColor: "#94a3b8",
    };
  }

  if (score < 60) {
    return {
      label: "风险较高",
      textClassName: "text-red-200",
      borderClassName: "border-red-300/40",
      gaugeColor: "#f87171",
    };
  }

  if (score < 75) {
    return {
      label: "需重点补强",
      textClassName: "text-amber-200",
      borderClassName: "border-amber-300/50",
      gaugeColor: "#f59e0b",
    };
  }

  if (score < 90) {
    return {
      label: "接近可展示",
      textClassName: "text-lime-200",
      borderClassName: "border-lime-300/50",
      gaugeColor: "#a3e635",
    };
  }

  return {
    label: "展示状态较好",
    textClassName: "text-emerald-200",
    borderClassName: "border-emerald-300/50",
    gaugeColor: "#10b981",
  };
}

function isCautionAdvice(value: string) {
  return /不适合|暂不|不建议|不足|需要|需|风险|缺少|补强/.test(value);
}

export function ReportOverviewSummary({
  analysis,
  onePageSummary,
  scoreDisplay,
  copySummaryMessage,
  onCopyOnePageSummary,
}: ReportOverviewSummaryProps) {
  const scoreValue = clampScore(analysis.overallScore);
  const scoreLabel = analysis.overallScore ?? "-";
  const scoreTone = getScoreTone(analysis.overallScore);
  const gaugeBackground = `conic-gradient(${scoreTone.gaugeColor} ${
    scoreValue * 3.6
  }deg, rgba(255,255,255,0.11) 0deg)`;
  const insightItems = [
    {
      label: "优势",
      title: "最大优势",
      value: onePageSummary.strongestPoint,
      className: "border-emerald-300/30 bg-emerald-300/10 text-emerald-100",
    },
    {
      label: "短板",
      title: "最大短板",
      value: onePageSummary.biggestWeakness,
      className: "border-amber-300/40 bg-amber-300/10 text-amber-100",
    },
    {
      label: "重点",
      title: "下一轮重点",
      value: onePageSummary.nextTrainingFocus,
      className: "border-sky-300/30 bg-sky-300/10 text-sky-100",
    },
    {
      label: "展示",
      title: "正式展示建议",
      value: onePageSummary.readinessAdvice,
      className: isCautionAdvice(onePageSummary.readinessAdvice)
        ? "border-red-300/40 bg-red-300/10 text-red-100"
        : "border-slate-300/25 bg-white/[0.04] text-slate-200",
    },
  ];
  const hasScoreNotes =
    Boolean(scoreDisplay.weakScoreNote) || scoreDisplay.messages.length > 0;

  return (
    <section className="overflow-hidden rounded-lg border border-white/10 bg-slate-950 text-white shadow-sm">
      <div className="grid gap-0 lg:grid-cols-[260px_minmax(0,1fr)]">
        <div className="border-b border-white/10 bg-[#071512] p-6 lg:border-b-0 lg:border-r">
          <div className="mx-auto w-fit">
            <div
              className="grid h-40 w-40 place-items-center rounded-full p-2"
              style={{ background: gaugeBackground }}
              aria-label={`${scoreDisplay.title} ${scoreLabel}/100`}
            >
              <div className="grid h-full w-full place-items-center rounded-full bg-[#071512] text-center">
                <div>
                  <p className="text-xs font-semibold text-slate-400">
                    {scoreDisplay.title}
                  </p>
                  <p className="mt-1 text-5xl font-semibold leading-none tabular-nums text-white">
                    {scoreLabel}
                  </p>
                  <p className="mt-1 text-xs text-slate-400">/100</p>
                </div>
              </div>
            </div>
            <div
              className={`mt-4 rounded-md border px-3 py-2 text-center ${scoreTone.borderClassName}`}
            >
              <p className={`text-sm font-semibold ${scoreTone.textClassName}`}>
                {scoreTone.label}
              </p>
              <p className="mt-1 text-xs text-slate-400">暂无上次训练对比</p>
            </div>
          </div>
        </div>

        <div className="p-6 sm:p-7 lg:p-8">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <p className="text-xs font-semibold text-teal-300">
                核心判断
              </p>
              <h2 className="mt-2 text-2xl font-semibold text-white">
                本次训练结论
              </h2>
            </div>
            <div className="flex flex-col items-start gap-2 sm:items-end">
              <button
                type="button"
                onClick={onCopyOnePageSummary}
                className="inline-flex h-9 items-center justify-center rounded-md border border-white/10 bg-white/[0.04] px-3 text-xs font-semibold text-slate-100 transition-colors hover:border-teal-300/50 hover:bg-teal-300/10"
              >
                复制复盘摘要
              </button>
              {copySummaryMessage ? (
                <p className="text-xs font-medium text-teal-300">
                  {copySummaryMessage}
                </p>
              ) : null}
            </div>
          </div>
          <p className="mt-5 max-w-3xl text-base leading-7 text-slate-200">
            {onePageSummary.conclusion || analysis.summary}
          </p>
          <p className="mt-4 max-w-2xl text-sm leading-6 text-slate-400">
            {scoreDisplay.subtitle}
          </p>
        </div>
      </div>

      <div className="grid gap-2 border-t border-white/10 bg-white/[0.03] p-3 lg:grid-cols-4">
        {insightItems.map((item) => (
          <div
            key={item.title}
            className={`rounded-md border px-4 py-3 ${item.className}`}
          >
            <div className="flex items-center gap-2">
              <span className="rounded border border-current/30 px-1.5 py-0.5 text-xs font-semibold">
                {item.label}
              </span>
              <p className="text-xs font-semibold opacity-80">{item.title}</p>
            </div>
            <p className="mt-2 line-clamp-2 text-sm leading-6">{item.value}</p>
          </div>
        ))}
      </div>

      {hasScoreNotes ? (
        <div className="border-t border-white/10 px-6 py-4 sm:px-7">
          <div className="grid gap-3">
            {scoreDisplay.weakScoreNote ? (
              <div
                className="rounded-md border border-white/10 bg-white/[0.04] p-3 text-xs leading-5 text-slate-300"
              >
                {scoreDisplay.weakScoreNote}
              </div>
            ) : null}
            {scoreDisplay.messages.map((message) => (
              <div
                key={message}
                className="rounded-md border border-amber-300/30 bg-amber-300/10 p-3 text-xs leading-5 text-amber-100"
              >
                {message}
              </div>
            ))}
          </div>
        </div>
      ) : null}
    </section>
  );
}
