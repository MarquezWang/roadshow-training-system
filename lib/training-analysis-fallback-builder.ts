import {
  validateTrainingAnalysisResult,
  type QaReview,
} from "@/lib/training-analysis-validator";
import type { TrainingAnalysisFallbackReason } from "@/lib/training-analysis-fallback";

const FALLBACK_ANALYSIS_SCORE = 15;
const COVERAGE_ITEMS = [
  "项目背景",
  "痛点问题",
  "技术方案",
  "核心创新",
  "应用场景",
  "市场空间",
  "商业模式",
  "团队能力",
  "融资/合作需求",
] as const;

export type TrainingAnalysisQuestionData = {
  questionId: string;
  orderIndex: number;
  questionType: string | null;
  source: string;
  questionText: string;
  answerDurationSec: number | null;
  answerText: string | null;
  transcribeText: string | null;
  transcribeStatus: string | null;
  transcribeFailed: boolean;
  transcribePending: boolean;
  transcribeNote: string | null;
};

function summarizeAnswer(question: TrainingAnalysisQuestionData) {
  const answerText =
    question.transcribeText?.trim() || question.answerText?.trim();

  if (answerText) {
    return answerText.length > 120 ? `${answerText.slice(0, 120)}...` : answerText;
  }

  if (question.transcribePending) {
    return "回答转写尚未完成，当前降级报告无法准确概括回答内容。";
  }

  if (question.transcribeFailed) {
    return "回答转写失败，当前降级报告无法准确概括回答内容。";
  }

  return "未检测到可用于复盘的有效回答文本。";
}

function buildFallbackQaReview(
  question: TrainingAnalysisQuestionData,
): QaReview {
  const hasAnswerText = Boolean(
    question.transcribeText?.trim() || question.answerText?.trim(),
  );

  return {
    questionId: question.questionId,
    questionIndex: question.orderIndex,
    dimension: "OTHER",
    question: question.questionText,
    judgeIntent: "评委意图暂未能由 AI 结构化结果稳定解析，当前为降级复盘。",
    answerSummary: summarizeAnswer(question),
    responseQuality: hasAnswerText ? "PARTIAL" : "WEAK",
    responseQualityLabel: hasAnswerText
      ? "降级复盘，需人工复核"
      : "回答依据不足",
    missingPoints: [
      "结构化报告生成失败，当前无法完整判断回答覆盖情况",
      "建议补充数据、案例或验证依据来支撑回答",
    ],
    evidenceUse: hasAnswerText
      ? "检测到回答文本，但证据使用情况需人工复核。"
      : "未能提取到有效回答证据。",
    improvementAdvice:
      "建议围绕评委问题先给出直接结论，再补充关键事实、数据或案例支撑。",
    betterAnswerOutline: [
      "先正面回答问题核心",
      "补充项目相关数据、案例或验证结果",
      "总结对落地、风险或商业化的影响",
    ],
  };
}

export function buildFallbackTrainingAnalysis(input: {
  durationSec: number;
  pageCount: number | null;
  slideEventCount: number;
  transcriptMissing: boolean;
  qaData: TrainingAnalysisQuestionData[];
  dynamicFollowupData: TrainingAnalysisQuestionData | null;
  failureReason: TrainingAnalysisFallbackReason;
}) {
  const fallbackSummary =
    input.failureReason === "AI_EMPTY_CONTENT"
      ? "报告生成时 AI 未返回有效内容，系统已基于可用转写和答辩数据生成基础报告，并保留排查信息。"
      : input.failureReason === "NO_ANALYZABLE_TEXT"
        ? "本轮训练缺少可分析的转写或回答文本，系统已根据录音元信息生成基础报告。"
        : "报告生成时 AI 结构化输出不符合报告 Schema，修复重试失败后系统已生成基础报告，并保留排查信息。";
  const fallbackAnalysis = {
    overallScore: FALLBACK_ANALYSIS_SCORE,
    summary: fallbackSummary,
    strengths: [],
    weaknesses: [
      "结构化报告生成失败，当前报告为降级版本，细节判断可能不完整。",
      input.transcriptMissing
        ? "路演转写缺失或不可用，无法充分评估项目表达。"
        : "当前降级报告未能完整抽取路演中的证据覆盖情况。",
      "答辩复盘仅基于已有问题、回答文本和转写状态生成，建议人工复核关键判断。",
    ],
    suggestions: [
      "本次报告为降级版本，建议先结合录音回放人工复核关键判断。",
      "下一轮路演中请用数字、客户案例、测试结果或合同订单支撑关键结论。",
      "答辩时先直接回应评委问题，再补充证据和下一步计划。",
      "如系统持续生成降级报告，请由管理员查看诊断信息并调整分析配置。",
    ],
    contentCoverage: COVERAGE_ITEMS.map((item) => ({
      item,
      covered: "false",
      evidence: input.transcriptMissing
        ? "路演转写缺失，无法确认覆盖情况。"
        : "降级报告未能稳定解析该维度证据。",
      suggestion: `建议补充${item}相关的可验证事实、数据或案例。`,
    })),
    timing: {
      durationSec: input.durationSec,
      targetDurationSec: 540,
      assessment: "当前为降级报告，仅保留基础时长信息。",
      opening: "降级报告未能细分开场节奏。",
      middle: "降级报告未能细分中段表达节奏。",
      ending: "降级报告未能细分结尾收束情况。",
      suggestion: "建议按背景、方案、验证、商业化和需求拆分路演时间。",
    },
    slideSync: {
      slideEventCount: input.slideEventCount,
      pageCount: input.pageCount ?? 0,
      assessment: "当前为降级报告，仅保留基础翻页信息。",
      frequentFlipRisk: "降级报告未能判断是否频繁翻页。",
      longStayRisk: "降级报告未能判断是否长时间停留。",
      suggestion: "建议按核心章节控制翻页节奏，避免讲述与页面信息脱节。",
    },
    riskQuestions: [
      "请说明项目当前最关键的验证指标是什么，以及已有数据是否达标？",
      "如果客户转化或落地进度低于预期，你们准备如何调整？",
      "项目在技术实现、交付和运营过程中最大的风险是什么？",
      "后续融资或合作需求将如何对应到明确的里程碑？",
    ],
    qaReviews: input.qaData.map(buildFallbackQaReview),
    dynamicFollowupReview: input.dynamicFollowupData
      ? {
          questionId: input.dynamicFollowupData.questionId,
          question: input.dynamicFollowupData.questionText,
          answerSummary: summarizeAnswer(input.dynamicFollowupData),
          targetWeakness:
            "动态追问表现未能由 AI 结构化结果稳定解析，当前为降级复盘。",
          evidenceSupplement:
            "请人工复核该回答是否补充了数据、案例或验证依据。",
          improvementAdvice:
            "建议围绕动态追问的核心点补充直接结论、关键证据和下一步计划。",
        }
      : null,
  };

  return validateTrainingAnalysisResult(fallbackAnalysis);
}
