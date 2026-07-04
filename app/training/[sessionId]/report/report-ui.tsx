"use client";

import type { ReactNode, RefObject } from "react";

export {
  REPORT_GENERATION_FAILURE_MESSAGE,
  ReportGenerationPanel,
} from "./report-generation-panel";

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
    <nav className="sticky top-0 z-10 -mx-6 border-b border-[var(--border)] bg-[var(--surface)]/95 px-6 backdrop-blur sm:-mx-8 sm:px-8 lg:-mx-10 lg:px-10">
      {tabs.map((tab) => (
        <button
          key={tab.key}
          type="button"
          onClick={() => onChange(tab.key)}
          className={`relative -mb-px px-4 py-2.5 text-sm font-medium transition-colors ${
            activeTab === tab.key
              ? "border-b-2 border-teal-300 text-[var(--surface-foreground)]"
              : "text-[var(--muted-foreground)] hover:text-[var(--surface-foreground)]"
          }`}
        >
          {tab.label}
        </button>
      ))}
    </nav>
  );
}

export function ReportContentContainer({
  contentRef,
  children,
}: Readonly<{
  contentRef: RefObject<HTMLDivElement | null>;
  children: ReactNode;
}>) {
  return (
    <div ref={contentRef} className="scroll-mt-14">
      {children}
    </div>
  );
}
