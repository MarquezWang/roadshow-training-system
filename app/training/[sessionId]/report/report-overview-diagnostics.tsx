"use client";

type Diagnostics = {
  content: string[];
  delivery: string[];
  qa: string[];
};

type DiagnosticCardProps = Readonly<{
  title: string;
  label: string;
  items: string[];
  fallback: string;
  tone: "content" | "delivery" | "qa";
}>;

type ReportOverviewDiagnosticsProps = Readonly<{
  diagnostics: Diagnostics;
  onOpenPitchTab: () => void;
  onOpenQaTab: () => void;
}>;

const toneClassNames = {
  content: {
    label: "text-teal-300",
    dot: "bg-teal-300",
    bar: "bg-teal-300",
    border: "border-teal-300/40",
  },
  delivery: {
    label: "text-amber-300",
    dot: "bg-amber-300",
    bar: "bg-amber-300",
    border: "border-amber-300/40",
  },
  qa: {
    label: "text-sky-300",
    dot: "bg-sky-300",
    bar: "bg-sky-300",
    border: "border-sky-300/40",
  },
};

function DiagnosticCard({
  title,
  label,
  items,
  fallback,
  tone,
}: DiagnosticCardProps) {
  const displayItems = items.length > 0 ? items : [fallback];
  const toneClassName = toneClassNames[tone];

  return (
    <div className="p-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className={`text-xs font-semibold ${toneClassName.label}`}>
            {label}
          </p>
          <h3 className="mt-2 text-base font-semibold text-white">
            {title}
          </h3>
        </div>
        <p className="text-sm font-semibold text-slate-400">
          {displayItems.length}
        </p>
      </div>
      <ol className="mt-4 space-y-3 text-sm leading-6 text-slate-300">
        {displayItems.map((item, index) => (
          <li
            key={index}
            className={`rounded-md border bg-white/[0.03] p-3 ${index === 0 ? toneClassName.border : "border-white/10"}`}
          >
            <span className="flex items-center gap-2 text-xs font-semibold text-slate-400">
              <span className={`h-1.5 w-1.5 rounded-full ${toneClassName.dot}`} />
              {index === 0 ? "关键硬伤" : "次要问题"}
            </span>
            <span className="mt-2 block">{item}</span>
          </li>
        ))}
      </ol>
    </div>
  );
}

function getSegmentPercent(count: number, total: number) {
  if (total <= 0) {
    return 0;
  }

  return Math.max(8, Math.round((count / total) * 100));
}

export function ReportOverviewDiagnostics({
  diagnostics,
  onOpenPitchTab,
  onOpenQaTab,
}: ReportOverviewDiagnosticsProps) {
  const counts = {
    content: diagnostics.content.length,
    delivery: diagnostics.delivery.length,
    qa: diagnostics.qa.length,
  };
  const totalCount = counts.content + counts.delivery + counts.qa;
  const segments = [
    {
      key: "content",
      label: "内容",
      count: counts.content,
      className: toneClassNames.content.bar,
    },
    {
      key: "delivery",
      label: "表达",
      count: counts.delivery,
      className: toneClassNames.delivery.bar,
    },
    {
      key: "qa",
      label: "答辩",
      count: counts.qa,
      className: toneClassNames.qa.bar,
    },
  ];

  return (
    <section className="overflow-hidden rounded-lg border border-white/10 bg-slate-950 text-white shadow-sm">
      <div className="border-b border-white/10 px-5 py-4">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="text-xs font-semibold text-slate-400">诊断拆解</p>
            <h2 className="mt-1 text-lg font-semibold text-white">
              本轮问题集中在哪
              <span className="ml-2 rounded-md border border-white/10 bg-white/[0.04] px-2 py-0.5 text-xs font-semibold text-slate-300">
                {totalCount || 0}
              </span>
            </h2>
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={onOpenPitchTab}
              className="inline-flex h-8 items-center rounded-md border border-white/10 px-3 text-xs font-semibold text-slate-200 transition-colors hover:border-teal-300/50 hover:bg-teal-300/10"
            >
              查看路演表现
            </button>
            <button
              type="button"
              onClick={onOpenQaTab}
              className="inline-flex h-8 items-center rounded-md border border-white/10 px-3 text-xs font-semibold text-slate-200 transition-colors hover:border-sky-300/50 hover:bg-sky-300/10"
            >
              查看答辩表现
            </button>
          </div>
        </div>
        <div className="mt-4 h-2 overflow-hidden rounded-full bg-white/10">
          {segments.map((segment) =>
            segment.count > 0 ? (
              <div
                key={segment.key}
                className={`inline-block h-full ${segment.className}`}
                style={{
                  width: `${getSegmentPercent(segment.count, totalCount)}%`,
                }}
                title={`${segment.label} ${segment.count}`}
              />
            ) : null,
          )}
        </div>
        <div className="mt-3 flex flex-wrap gap-x-5 gap-y-2 text-xs text-slate-400">
          {segments.map((segment) => (
            <span key={segment.key}>
              {segment.label} {segment.count}
            </span>
          ))}
        </div>
      </div>
      <div className="grid divide-y divide-white/10 lg:grid-cols-3 lg:divide-x lg:divide-y-0">
        <DiagnosticCard
          title="路演内容诊断"
          label="内容"
          items={diagnostics.content}
          fallback="暂无更细的内容诊断，建议查看内容覆盖与证据充分性。"
          tone="content"
        />
        <DiagnosticCard
          title="表达与节奏诊断"
          label="表达"
          items={diagnostics.delivery}
          fallback="暂无更细的表达诊断，建议查看路演表现分析。"
          tone="delivery"
        />
        <DiagnosticCard
          title="答辩表现诊断"
          label="答辩"
          items={diagnostics.qa}
          fallback="如本轮已完成答辩，可在答辩表现页查看逐题复盘。"
          tone="qa"
        />
      </div>
    </section>
  );
}
