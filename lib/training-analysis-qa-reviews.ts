import type { TrainingAnalysisQuestionData } from "@/lib/training-analysis-fallback-builder";
import type {
  QaReview,
  TrainingAnalysisResult,
} from "@/lib/training-analysis-validator";

export function normalizeTrainingAnalysisQaReviews(
  analysis: TrainingAnalysisResult,
  qaData: TrainingAnalysisQuestionData[],
): TrainingAnalysisResult {
  const noAnswerQuestionIds = new Set(
    qaData
      .filter((question) => {
        if (question.answerDurationSec === null) return true;
        if (question.answerDurationSec < 2) return true;
        if (question.transcribeStatus === "FAILED") return true;
        if (
          question.transcribeStatus === "COMPLETED" &&
          !question.transcribeText?.trim()
        ) {
          return true;
        }
        return false;
      })
      .map((question) => question.questionId),
  );
  const pendingTranscribeQuestionIds = new Set(
    qaData
      .filter((question) => question.transcribePending)
      .map((question) => question.questionId),
  );
  const existingQaReviews = analysis.qaReviews ?? [];
  const reviewedQuestionIds = new Set(
    existingQaReviews.map((review) => review.questionId),
  );
  const missingReviews: QaReview[] = qaData
    .filter((question) => !reviewedQuestionIds.has(question.questionId))
    .map((question) => {
      const isNoAnswer = noAnswerQuestionIds.has(question.questionId);
      const isPending = pendingTranscribeQuestionIds.has(question.questionId);

      return {
        questionId: question.questionId,
        questionIndex: question.orderIndex,
        dimension: "OTHER",
        question: question.questionText,
        judgeIntent: "评委意图暂未明确记录。",
        answerSummary: isPending
          ? "转写尚未完成，分析依据不足。"
          : isNoAnswer
            ? "未检测到有效回答，或当前转写文本不足以判断回答内容。"
            : "回答摘要暂时无法提供。",
        responseQuality: "WEAK",
        responseQualityLabel: isPending
          ? "转写超时，分析依据不足"
          : "回答缺失或偏弱",
        missingPoints: isNoAnswer
          ? ["未正面回应评委问题", "未提供数据、案例或材料依据"]
          : [],
        evidenceUse: "未能提供有效证据。",
        improvementAdvice:
          "建议围绕评委问题正面作答，并补充关键数据、案例或验证依据。",
        betterAnswerOutline: [
          `针对"${question.questionText}"，建议先明确回答核心问题`,
          "结合项目材料补充关键数据或案例",
          "总结回答要点，呼应评委关注点",
        ],
      };
    });
  const normalizedQaReviews = existingQaReviews.map((review) => {
    if (noAnswerQuestionIds.has(review.questionId)) {
      return normalizeWeakReview(review, {
        responseQualityLabel: "回答缺失或偏弱",
        answerSummary: "未检测到有效回答，或当前转写文本不足以判断回答内容。",
        missingPoints: ["未正面回应评委问题", "未提供数据、案例或材料依据"],
        improvementAdvice:
          "建议围绕评委问题正面作答，并补充关键数据、案例或验证依据。",
      });
    }

    if (pendingTranscribeQuestionIds.has(review.questionId)) {
      return normalizeWeakReview(review, {
        responseQualityLabel: "转写超时，分析依据不足",
        answerSummary: "转写尚未完成，分析依据不足。",
        missingPoints: ["转写未完成，无法评估回答内容"],
        improvementAdvice: "转写完成后可重新生成分析以获得更准确的评估。",
      });
    }

    return review;
  });

  return {
    ...analysis,
    qaReviews: [...normalizedQaReviews, ...missingReviews],
  };
}

function normalizeWeakReview(
  review: QaReview,
  fallback: Readonly<{
    responseQualityLabel: string;
    answerSummary: string;
    missingPoints: string[];
    improvementAdvice: string;
  }>,
): QaReview {
  return {
    ...review,
    responseQuality: "WEAK",
    responseQualityLabel: fallback.responseQualityLabel,
    answerSummary: review.answerSummary || fallback.answerSummary,
    evidenceUse: review.evidenceUse || "未能提供有效证据。",
    missingPoints: review.missingPoints?.length
      ? review.missingPoints
      : fallback.missingPoints,
    improvementAdvice: review.improvementAdvice || fallback.improvementAdvice,
    betterAnswerOutline: review.betterAnswerOutline?.length
      ? review.betterAnswerOutline
      : [
          `针对"${review.question}"，建议先明确回答核心问题`,
          "结合项目材料补充关键数据或案例",
          "总结回答要点，呼应评委关注点",
        ],
  };
}
