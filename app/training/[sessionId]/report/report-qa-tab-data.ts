import {
  hasEnteredQaQuestion,
  isDynamicFollowupQuestion,
  type TrainingQaQuestion,
} from "./report-types";
import type { ReportTrainingAnalysis } from "./use-report-analysis-generation";

export function getReportQaTabData(
  qaQuestions: TrainingQaQuestion[],
  analysis: ReportTrainingAnalysis | null,
) {
  // 只展示用户实际进入过的题目。
  const baseQuestions = qaQuestions.filter(
    (q) => !isDynamicFollowupQuestion(q),
  );
  const enteredQuestions = baseQuestions.filter(hasEnteredQaQuestion);
  const dynamicFollowupQuestion =
    qaQuestions.find(
      (q) => isDynamicFollowupQuestion(q) && hasEnteredQaQuestion(q),
    ) ?? null;
  const dynamicFollowupReview = analysis?.dynamicFollowupReview ?? null;
  const skippedCount = baseQuestions.length - enteredQuestions.length;
  // QA 复盘也仅过滤已进入的题目
  const enteredQuestionIds = new Set(enteredQuestions.map((q) => q.id));
  const enteredQaReviews = (analysis?.qaReviews ?? []).filter((r) =>
    enteredQuestionIds.has(r.questionId),
  );

  return {
    enteredQuestions,
    dynamicFollowupQuestion,
    dynamicFollowupReview,
    enteredQaReviews,
    skippedCount,
  };
}
