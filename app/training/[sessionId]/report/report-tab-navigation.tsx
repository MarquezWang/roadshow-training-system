"use client";

export type ReportTabKey =
  | "overview"
  | "pitch"
  | "qa"
  | "abort-overview"
  | "abort-pitch"
  | "abort-qa";

export function ReportTabNavigation({
  isAborted,
  isAnalysisCompleted,
  activeTab,
  onChange,
}: Readonly<{
  isAborted: boolean;
  isAnalysisCompleted: boolean;
  activeTab: ReportTabKey;
  onChange: (tab: ReportTabKey) => void;
}>) {
  const tabs: Array<{ key: ReportTabKey; label: string }> = isAborted
    ? [
        { key: "abort-overview", label: "中止概览" },
        { key: "abort-pitch", label: "路演记录" },
        { key: "abort-qa", label: "答辩记录" },
      ]
    : isAnalysisCompleted
      ? [
          { key: "overview", label: "总览" },
          { key: "pitch", label: "路演表现" },
          { key: "qa", label: "答辩表现" },
        ]
      : [];

  if (tabs.length === 0) {
    return null;
  }

  return (
    <nav className="sticky top-0 z-10 rounded-lg border border-slate-800 bg-slate-950/75 px-4 shadow-sm backdrop-blur">
      <div className="flex h-12 gap-6 overflow-x-auto">
        {tabs.map((tab) => (
          <button
            key={tab.key}
            type="button"
            onClick={() => onChange(tab.key)}
            className={`h-12 shrink-0 border-b-2 px-1 text-sm font-medium transition-colors ${
              activeTab === tab.key
                ? "border-teal-300 text-white"
                : "border-transparent text-slate-400 hover:text-slate-100"
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>
    </nav>
  );
}
