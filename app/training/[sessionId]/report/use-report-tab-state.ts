"use client";

import { useEffect, useRef, useState } from "react";
import type { ReportTabKey } from "./report-ui";

type UseReportTabStateOptions = Readonly<{
  isAborted: boolean;
}>;

export function useReportTabState({ isAborted }: UseReportTabStateOptions) {
  const [activeTab, setActiveTab] = useState<ReportTabKey>(
    isAborted ? "abort-overview" : "overview",
  );
  const contentRef = useRef<HTMLDivElement>(null);
  const [showAllCoverage, setShowAllCoverage] = useState(false);

  // 切换 Tab 时回到内容顶部
  useEffect(() => {
    const el = contentRef.current;

    if (el) {
      el.scrollIntoView({ block: "start" });
    }
  }, [activeTab]);

  return {
    activeTab,
    setActiveTab,
    contentRef,
    showAllCoverage,
    toggleShowAllCoverage: () => setShowAllCoverage((previous) => !previous),
  };
}
