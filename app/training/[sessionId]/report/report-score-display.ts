import type { TrainingValidity } from "./report-validity";

export type ReportScoreDisplayState = Readonly<{
  showPrimaryScore: boolean;
  title: string;
  subtitle: string;
  weakScoreNote: string | null;
  messages: string[];
}>;

type ReportScoreAnalysis = Readonly<{
  overallScore: number | null;
  isFallbackReport: boolean;
}>;

export function getReportScoreDisplayState(
  analysis: ReportScoreAnalysis | null,
  trainingValidity: TrainingValidity,
): ReportScoreDisplayState {
  const messages = [
    ...(analysis?.isFallbackReport
      ? [
          "报告生成 AI 结构化结果不完整，系统已基于可用记录生成基础报告。",
        ]
      : []),
    ...trainingValidity.messages,
  ];
  const shouldSuppressScore =
    Boolean(analysis?.isFallbackReport) || trainingValidity.level !== "NORMAL";

  if (shouldSuppressScore) {
    return {
      showPrimaryScore: false,
      title: "本次训练报告不完整",
      subtitle: "暂不建议参考本次分数",
      weakScoreNote:
        analysis?.overallScore !== null && analysis?.overallScore !== undefined
          ? "系统保留了内部诊断分，但由于报告生成不完整或训练样本不足，不建议作为训练表现判断依据。"
          : null,
      messages,
    };
  }

  return {
    showPrimaryScore: true,
    title: "本次训练表现分",
    subtitle: "该分数仅基于本次模拟路演与答辩表现生成，不代表项目正式评审结果。",
    weakScoreNote: null,
    messages,
  };
}
