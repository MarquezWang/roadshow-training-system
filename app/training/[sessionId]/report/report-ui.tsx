"use client";

import type { ReactNode, RefObject } from "react";

export {
  REPORT_GENERATION_FAILURE_MESSAGE,
  ReportGenerationPanel,
} from "./report-generation-panel";
export { ReportTabNavigation, type ReportTabKey } from "./report-tab-navigation";

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
