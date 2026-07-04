"use client";

import {
  REPORT_GENERATION_FAILURE_MESSAGE,
  ReportGenerationPanel,
} from "./report-ui";
import { ReportOverviewSummary } from "./report-overview-summary";

type OverviewAnalysis = {
  status: string;
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

type Diagnostics = {
  content: string[];
  delivery: string[];
  qa: string[];
};

type ActionItem = {
  issue: string;
  whyItMatters: string;
  howToFix: string;
  sampleWording: string;
};

type ReportOverviewTabProps = Readonly<{
  analysis: OverviewAnalysis | null;
  onePageSummary: OnePageSummary;
  diagnostics: Diagnostics;
  actionItems: ActionItem[];
  nextTrainingTasks: string[];
  copySummaryMessage: string;
  isAborted: boolean;
  isAnalysisLoading: boolean;
  analysisMessage: string;
  reportGenerationElapsedMs: number;
  canRetryAnalysisGeneration: boolean;
  onCopyOnePageSummary: () => void;
  onRetryAnalysisGeneration: () => void;
}>;

export function ReportOverviewTab({
  analysis,
  onePageSummary,
  diagnostics,
  actionItems,
  nextTrainingTasks,
  copySummaryMessage,
  isAborted,
  isAnalysisLoading,
  analysisMessage,
  reportGenerationElapsedMs,
  canRetryAnalysisGeneration,
  onCopyOnePageSummary,
  onRetryAnalysisGeneration,
}: ReportOverviewTabProps) {
  return (
    <div className="grid gap-6">
      {analysis?.status === "COMPLETED" ? (
        <ReportOverviewSummary
          analysis={analysis}
          onePageSummary={onePageSummary}
          copySummaryMessage={copySummaryMessage}
          onCopyOnePageSummary={onCopyOnePageSummary}
        />
      ) : null}

      {analysis?.status === "COMPLETED" ? (
        <section className="grid gap-4 lg:grid-cols-3">
          <div className="rounded-lg border border-slate-100 bg-white p-5">
            <h3 className="text-sm font-semibold text-slate-800">
              路演内容诊断
            </h3>
            <ul className="mt-3 space-y-2 text-sm leading-6 text-slate-600">
              {(diagnostics.content.length > 0
                ? diagnostics.content
                : ["暂无更细的内容诊断，建议查看内容覆盖与证据充分性。"]
              ).map((item, index) => (
                <li key={index}>· {item}</li>
              ))}
            </ul>
          </div>
          <div className="rounded-lg border border-slate-100 bg-white p-5">
            <h3 className="text-sm font-semibold text-slate-800">
              表达与节奏诊断
            </h3>
            <ul className="mt-3 space-y-2 text-sm leading-6 text-slate-600">
              {(diagnostics.delivery.length > 0
                ? diagnostics.delivery
                : ["暂无更细的表达诊断，建议查看路演表现分析。"]
              ).map((item, index) => (
                <li key={index}>· {item}</li>
              ))}
            </ul>
          </div>
          <div className="rounded-lg border border-slate-100 bg-white p-5">
            <h3 className="text-sm font-semibold text-slate-800">
              答辩表现诊断
            </h3>
            <ul className="mt-3 space-y-2 text-sm leading-6 text-slate-600">
              {(diagnostics.qa.length > 0
                ? diagnostics.qa
                : ["如本轮已完成答辩，可在答辩表现页查看逐题复盘。"]
              ).map((item, index) => (
                <li key={index}>· {item}</li>
              ))}
            </ul>
          </div>
        </section>
      ) : null}

      {analysis?.status === "COMPLETED" && actionItems.length > 0 ? (
        <section className="rounded-lg border border-slate-100 bg-white p-6">
          <div className="flex flex-col gap-1 border-b border-slate-100 pb-4">
            <h2 className="text-sm font-semibold text-slate-800">
              可直接执行的修改建议
            </h2>
            <p className="text-xs text-slate-400">
              按“问题—影响—改法—参考话术”拆解，便于下一轮直接改稿。
            </p>
          </div>
          <div className="mt-4 grid gap-4">
            {actionItems.slice(0, 4).map((item, index) => (
              <div
                key={index}
                className="rounded-xl border border-slate-100 bg-slate-50/60 p-4"
              >
                <p className="text-sm font-semibold text-slate-900">
                  {index + 1}. {item.issue}
                </p>
                <div className="mt-3 grid gap-3 text-sm leading-6 text-slate-600 lg:grid-cols-3">
                  <p>
                    <span className="font-medium text-slate-800">影响：</span>
                    {item.whyItMatters}
                  </p>
                  <p>
                    <span className="font-medium text-slate-800">改法：</span>
                    {item.howToFix}
                  </p>
                  <p>
                    <span className="font-medium text-slate-800">
                      参考话术：
                    </span>
                    {item.sampleWording}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </section>
      ) : null}

      {analysis?.status === "COMPLETED" && nextTrainingTasks.length > 0 ? (
        <section className="rounded-lg border border-blue-100 bg-blue-50/60 p-6">
          <h2 className="text-sm font-semibold text-blue-900">
            下一轮训练任务
          </h2>
          <div className="mt-3 grid gap-3 lg:grid-cols-3">
            {nextTrainingTasks.slice(0, 3).map((task, index) => (
              <div
                key={index}
                className="rounded-lg border border-blue-100 bg-white/80 p-4 text-sm leading-6 text-blue-950/80"
              >
                <p className="text-xs font-semibold text-blue-600">
                  任务 {index + 1}
                </p>
                <p className="mt-2">{task}</p>
              </div>
            ))}
          </div>
        </section>
      ) : null}

      {analysis?.status === "COMPLETED" ? null : isAborted ? (
        <section className="rounded-lg border border-slate-100 bg-white p-6">
          <div className="rounded-md border border-red-100 bg-red-50/50 p-5">
            <p className="text-sm font-medium text-red-700">本轮训练已中止</p>
            <p className="mt-1 text-sm text-red-600/80">
              本轮训练在正式流程中被中止，已完成内容会保留，但不能继续本轮路演或答辩。
            </p>
          </div>
        </section>
      ) : isAnalysisLoading ? (
        <section className="rounded-lg border border-slate-800 bg-slate-950/40 p-4">
          <ReportGenerationPanel
            message={analysisMessage}
            elapsedMs={reportGenerationElapsedMs}
            canRetry={canRetryAnalysisGeneration}
            retryHint={
              canRetryAnalysisGeneration
                ? "系统检测到上一次报告生成可能已中断，可以重新触发生成。"
                : undefined
            }
            onRetry={onRetryAnalysisGeneration}
          />
        </section>
      ) : analysis?.status === "FAILED" ? (
        <section className="rounded-lg border border-slate-100 bg-white p-6">
          <div className="py-8 text-center">
            <p className="text-sm font-medium text-red-600">报告生成失败</p>
            <p className="mt-1 text-xs text-red-400">
              {REPORT_GENERATION_FAILURE_MESSAGE}
            </p>
            <button
              type="button"
              onClick={onRetryAnalysisGeneration}
              disabled={isAnalysisLoading}
              className="mt-4 inline-flex h-8 items-center justify-center rounded border border-red-200 bg-white px-3 text-xs font-medium text-red-600 transition-colors hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-50"
            >
              重试生成报告
            </button>
          </div>
        </section>
      ) : analysis ? (
        <section className="rounded-lg border border-slate-800 bg-slate-950/40 p-4">
          <ReportGenerationPanel
            message={analysisMessage}
            elapsedMs={reportGenerationElapsedMs}
            canRetry={canRetryAnalysisGeneration}
            retryHint={
              canRetryAnalysisGeneration
                ? "系统检测到上一次报告生成可能已中断，可以重新触发生成。"
                : undefined
            }
            onRetry={onRetryAnalysisGeneration}
          />
        </section>
      ) : (
        <section className="rounded-lg border border-slate-800 bg-slate-950/40 p-4">
          <ReportGenerationPanel
            message={analysisMessage || "正在准备报告数据，请稍候……"}
            elapsedMs={reportGenerationElapsedMs}
            canRetry={canRetryAnalysisGeneration}
            retryHint={
              canRetryAnalysisGeneration
                ? "系统检测到上一次报告生成可能已中断，可以重新触发生成。"
                : undefined
            }
            onRetry={onRetryAnalysisGeneration}
          />
        </section>
      )}
    </div>
  );
}
