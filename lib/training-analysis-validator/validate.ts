import {
  readObject,
  readString,
  readStringArray,
} from "./primitives";
import { validateCoverage } from "./coverage";
import {
  validateDynamicFollowupReview,
  validateQaReviews,
} from "./qa-reviews";
import {
  validateActionItems,
  validateDiagnostics,
  validateOnePageSummary,
} from "./report-details";
import type { TrainingAnalysisResult } from "./types";

export function validateTrainingAnalysisResult(
  analysisJson: unknown,
): TrainingAnalysisResult {
  const analysis = readObject(analysisJson, "analysisJson");
  const overallScore = Number(analysis.overallScore);

  if (
    !Number.isInteger(overallScore) ||
    overallScore < 0 ||
    overallScore > 100
  ) {
    throw new Error("overallScore 必须是 0 到 100 的整数。");
  }

  const summary = readString(analysis.summary, "summary");
  const strengths = readStringArray(analysis.strengths, "strengths", {
    max: 5,
  });
  const weaknesses = readStringArray(analysis.weaknesses, "weaknesses", {
    min: 3,
    max: 5,
  });
  const suggestions = readStringArray(analysis.suggestions, "suggestions", {
    max: 5,
  });

  return {
    overallScore,
    summary,
    strengths,
    weaknesses,
    suggestions,
    onePageSummary: validateOnePageSummary(analysis.onePageSummary, {
      summary,
      strengths,
      weaknesses,
      suggestions,
    }),
    diagnostics: validateDiagnostics(analysis.diagnostics),
    actionItems: validateActionItems(analysis.actionItems),
    nextTrainingTasks: readStringArray(
      analysis.nextTrainingTasks ?? suggestions,
      "nextTrainingTasks",
      { max: 5 },
    ),
    contentCoverage: validateCoverage(analysis.contentCoverage),
    timing: readObject(analysis.timing, "timing"),
    slideSync: readObject(analysis.slideSync, "slideSync"),
    riskQuestions: readStringArray(analysis.riskQuestions, "riskQuestions", {
      min: 3,
      max: 5,
    }),
    qaReviews: validateQaReviews(analysis.qaReviews),
    dynamicFollowupReview: validateDynamicFollowupReview(
      analysis.dynamicFollowupReview,
    ),
  };
}
