import { isRecord } from "@/lib/type-guards";
import { safeString, safeStringArray } from "./primitives";
import type {
  DynamicFollowupReview,
  QaReview,
} from "./types";

export function normalizeDimension(raw: string): QaReview["dimension"] {
  const normalized = raw.trim().toUpperCase();
  const dimensionMap: Record<string, QaReview["dimension"]> = {
    TECHNICAL: "TECHNICAL",
    TECH: "TECHNICAL",
    技术: "TECHNICAL",
    技术可行性: "TECHNICAL",
    MARKET: "MARKET",
    市场: "MARKET",
    商业: "MARKET",
    客户: "MARKET",
    竞争: "MARKET",
    RISK: "RISK",
    风险: "RISK",
    合规: "RISK",
    知识产权: "RISK",
    政策: "RISK",
    FINANCE: "FINANCE",
    财务: "FINANCE",
    融资: "FINANCE",
    收入: "FINANCE",
    成本: "FINANCE",
    TEAM: "TEAM",
    团队: "TEAM",
    成员: "TEAM",
    分工: "TEAM",
    OTHER: "OTHER",
  };

  return dimensionMap[normalized] ?? dimensionMap[raw] ?? "OTHER";
}

export function normalizeResponseQuality(
  raw: string,
): QaReview["responseQuality"] {
  const normalized = raw.trim().toUpperCase();
  if (normalized === "GOOD") return "GOOD";
  if (normalized === "PARTIAL") return "PARTIAL";
  return "WEAK";
}

export function validateQaReviews(value: unknown): QaReview[] | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }
  if (!Array.isArray(value)) {
    return undefined;
  }
  if (value.length === 0) {
    return [];
  }

  return value
    .filter((item): item is Record<string, unknown> => isRecord(item))
    .map((record, index): QaReview => {
      const rawDimension =
        typeof record.dimension === "string" ? record.dimension : "OTHER";
      const rawQuality =
        typeof record.responseQuality === "string"
          ? record.responseQuality
          : "WEAK";
      const responseQuality = normalizeResponseQuality(rawQuality);

      return {
        questionId: safeString(record.questionId, `auto-q${index + 1}`),
        questionIndex:
          typeof record.questionIndex === "number"
            ? record.questionIndex
            : index,
        dimension: normalizeDimension(rawDimension),
        question: safeString(record.question, `问题 ${index + 1}`),
        judgeIntent: safeString(
          record.judgeIntent,
          "评委意图暂未明确记录。",
        ),
        answerSummary: safeString(
          record.answerSummary,
          "回答摘要暂时无法提供。",
        ),
        responseQuality,
        responseQualityLabel: safeString(
          record.responseQualityLabel,
          responseQuality === "GOOD"
            ? "回答良好"
            : responseQuality === "PARTIAL"
              ? "部分回答"
              : "回答偏弱",
        ),
        missingPoints: safeStringArray(record.missingPoints),
        evidenceUse: safeString(record.evidenceUse, "未能提供有效证据。"),
        improvementAdvice: safeString(
          record.improvementAdvice,
          "建议围绕问题要点针对性作答。",
        ),
        betterAnswerOutline: safeStringArray(record.betterAnswerOutline),
      };
    });
}

export function validateDynamicFollowupReview(
  value: unknown,
): DynamicFollowupReview | null {
  if (value === undefined || value === null || !isRecord(value)) {
    return null;
  }

  return {
    questionId: safeString(value.questionId, ""),
    question: safeString(value.question, ""),
    answerSummary: safeString(value.answerSummary, ""),
    targetWeakness: safeString(value.targetWeakness, ""),
    evidenceSupplement: safeString(value.evidenceSupplement, ""),
    improvementAdvice: safeString(value.improvementAdvice, ""),
  };
}
