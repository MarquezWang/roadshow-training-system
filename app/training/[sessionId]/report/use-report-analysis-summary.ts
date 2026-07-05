"use client";

import { useCallback, useMemo, useState } from "react";

type ReportAnalysisSummary = {
  overallScore: number | null;
  summary: string;
  strengths: string[];
  weaknesses: string[];
  suggestions: string[];
  onePageSummary: {
    conclusion: string;
    strongestPoint: string;
    biggestWeakness: string;
    nextTrainingFocus: string;
    readinessAdvice: string;
  } | null;
  diagnostics: {
    content: string[];
    delivery: string[];
    qa: string[];
  } | null;
  actionItems: Array<{
    issue: string;
    whyItMatters: string;
    howToFix: string;
    sampleWording: string;
  }>;
  nextTrainingTasks: string[];
  contentCoverage: Array<{
    item: string;
    covered: string;
    evidence: string;
    suggestion: string;
  }>;
};

type UseReportAnalysisSummaryOptions = Readonly<{
  analysis: ReportAnalysisSummary | null;
}>;

export function useReportAnalysisSummary({
  analysis,
}: UseReportAnalysisSummaryOptions) {
  const [copySummaryMessage, setCopySummaryMessage] = useState("");

  const strengths = useMemo(
    () => (Array.isArray(analysis?.strengths) ? analysis.strengths : []),
    [analysis],
  );
  const weaknesses = useMemo(
    () => (Array.isArray(analysis?.weaknesses) ? analysis.weaknesses : []),
    [analysis],
  );
  const suggestions = useMemo(
    () => (Array.isArray(analysis?.suggestions) ? analysis.suggestions : []),
    [analysis],
  );
  const contentCoverage = useMemo(
    () =>
      Array.isArray(analysis?.contentCoverage)
        ? analysis.contentCoverage
        : [],
    [analysis],
  );
  const onePageSummary = useMemo(
    () =>
      analysis?.onePageSummary ?? {
        conclusion: analysis?.summary ?? "",
        strongestPoint: strengths[0] ?? "本轮暂未形成明确优势结论。",
        biggestWeakness: weaknesses[0] ?? "本轮暂未形成明确短板结论。",
        nextTrainingFocus:
          suggestions[0] ?? "下一轮建议先补齐路演中的关键证据。",
        readinessAdvice: "建议完成下一轮针对性训练后再进入正式展示。",
      },
    [analysis?.onePageSummary, analysis?.summary, strengths, suggestions, weaknesses],
  );
  const diagnostics = analysis?.diagnostics ?? {
    content: weaknesses.slice(0, 2),
    delivery: suggestions.slice(0, 2),
    qa: [],
  };
  const actionItems =
    Array.isArray(analysis?.actionItems) && analysis.actionItems.length > 0
      ? analysis.actionItems
      : suggestions.slice(0, 3).map((item) => ({
          issue: item,
          whyItMatters: "该问题会影响评委对项目价值、表达清晰度或证据可信度的判断。",
          howToFix: item,
          sampleWording: "可结合项目真实数据、客户案例或测试结果重写这一段表达。",
        }));
  const nextTrainingTasks =
    Array.isArray(analysis?.nextTrainingTasks) &&
    analysis.nextTrainingTasks.length > 0
      ? analysis.nextTrainingTasks
      : suggestions.slice(0, 3);

  const buildOnePageSummaryText = useCallback(() => {
    const score =
      analysis?.overallScore !== null && analysis?.overallScore !== undefined
        ? `${analysis.overallScore}/100`
        : "暂无评分";
    const taskLines =
      nextTrainingTasks.length > 0
        ? nextTrainingTasks
            .slice(0, 3)
            .map((task, index) => `${index + 1}. ${task}`)
            .join("\n")
        : "暂无明确任务";

    return [
      "训练报告摘要",
      "",
      `综合评分：${score}`,
      "",
      "本次训练结论：",
      onePageSummary.conclusion || analysis?.summary || "暂无结论",
      "",
      "最大优势：",
      onePageSummary.strongestPoint,
      "",
      "最大短板：",
      onePageSummary.biggestWeakness,
      "",
      "下一轮重点：",
      onePageSummary.nextTrainingFocus,
      "",
      "正式展示建议：",
      onePageSummary.readinessAdvice,
      "",
      "下一轮训练任务：",
      taskLines,
    ].join("\n");
  }, [analysis, nextTrainingTasks, onePageSummary]);

  const copyOnePageSummary = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(buildOnePageSummaryText());
      setCopySummaryMessage("已复制");
      window.setTimeout(() => setCopySummaryMessage(""), 1800);
    } catch {
      setCopySummaryMessage("复制失败，请手动选择文本");
    }
  }, [buildOnePageSummaryText]);

  return {
    strengths,
    weaknesses,
    suggestions,
    contentCoverage,
    onePageSummary,
    diagnostics,
    actionItems,
    nextTrainingTasks,
    copySummaryMessage,
    copyOnePageSummary,
  };
}

export type ReportAnalysisSummaryResult = ReturnType<
  typeof useReportAnalysisSummary
>;
