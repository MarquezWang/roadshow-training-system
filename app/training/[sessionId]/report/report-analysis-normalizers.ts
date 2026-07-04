import type { ReportTrainingAnalysis } from "./report-types";
import {
  parseActionItems,
  parseDiagnostics,
  parseDynamicFollowupReview,
  parseJsonArray,
  parseJsonObject,
  parseOnePageSummary,
} from "./report-page-parsers";

type SourceAnalysis = Readonly<{
  id: string;
  status: string;
  overallScore: number | null;
  summary: string;
  errorMessage: string | null;
  updatedAt: Date;
  strengthsJson: string | null;
  weaknessesJson: string | null;
  suggestionsJson: string | null;
  coverageJson: string | null;
  timingJson: string | null;
  slideSyncJson: string | null;
  riskQuestionsJson: string | null;
  rawResultJson: string | null;
}>;

export function normalizeReportAnalysis(
  analysis: SourceAnalysis | null | undefined,
): ReportTrainingAnalysis | null {
  if (!analysis) {
    return null;
  }

  const rawResult = parseJsonObject(analysis.rawResultJson);

  return {
    id: analysis.id,
    status: analysis.status,
    overallScore: analysis.overallScore,
    summary: analysis.summary,
    errorMessage: analysis.errorMessage,
    updatedAt: analysis.updatedAt.toISOString(),
    strengths: parseJsonArray<string>(analysis.strengthsJson),
    weaknesses: parseJsonArray<string>(analysis.weaknessesJson),
    suggestions: parseJsonArray<string>(analysis.suggestionsJson),
    onePageSummary: parseOnePageSummary(rawResult.onePageSummary),
    diagnostics: parseDiagnostics(rawResult.diagnostics),
    actionItems: parseActionItems(rawResult.actionItems),
    nextTrainingTasks: Array.isArray(rawResult.nextTrainingTasks)
      ? rawResult.nextTrainingTasks.filter(
          (item): item is string =>
            typeof item === "string" && item.trim().length > 0,
        )
      : [],
    contentCoverage: parseJsonArray<{
      item: string;
      covered: string;
      evidence: string;
      suggestion: string;
    }>(analysis.coverageJson),
    timing: parseJsonObject(analysis.timingJson),
    slideSync: parseJsonObject(analysis.slideSyncJson),
    riskQuestions: parseJsonArray<string>(analysis.riskQuestionsJson),
    qaReviews: Array.isArray(rawResult.qaReviews) ? rawResult.qaReviews : [],
    dynamicFollowupReview: parseDynamicFollowupReview(
      rawResult.dynamicFollowupReview,
    ),
  };
}
