import { isRecord } from "@/lib/type-guards";
import { safeString, safeStringArray } from "./primitives";
import type {
  ReportActionItem,
  ReportDiagnostics,
  ReportOnePageSummary,
} from "./types";

type SummaryFallback = Readonly<{
  summary: string;
  strengths: string[];
  weaknesses: string[];
  suggestions: string[];
}>;

export function validateOnePageSummary(
  value: unknown,
  fallback: SummaryFallback,
): ReportOnePageSummary {
  const record = isRecord(value) ? value : {};

  return {
    conclusion: safeString(record.conclusion, fallback.summary),
    strongestPoint: safeString(
      record.strongestPoint,
      fallback.strengths[0] ?? "本轮暂未形成明确优势结论。",
    ),
    biggestWeakness: safeString(
      record.biggestWeakness,
      fallback.weaknesses[0] ?? "本轮暂未形成明确短板结论。",
    ),
    nextTrainingFocus: safeString(
      record.nextTrainingFocus,
      fallback.suggestions[0] ?? "下一轮建议先补齐路演中的关键证据。",
    ),
    readinessAdvice: safeString(
      record.readinessAdvice,
      "建议完成下一轮针对性训练后再进入正式展示。",
    ),
  };
}

export function validateDiagnostics(value: unknown): ReportDiagnostics {
  const record = isRecord(value) ? value : {};

  return {
    content: safeStringArray(record.content).slice(0, 4),
    delivery: safeStringArray(record.delivery).slice(0, 4),
    qa: safeStringArray(record.qa).slice(0, 4),
  };
}

export function validateActionItems(value: unknown): ReportActionItem[] {
  if (!Array.isArray(value)) return [];

  return value
    .filter((item): item is Record<string, unknown> => isRecord(item))
    .map((record): ReportActionItem => ({
      issue: safeString(record.issue, "待优化问题暂未明确。"),
      whyItMatters: safeString(
        record.whyItMatters,
        "该问题会影响评委对项目价值和可信度的判断。",
      ),
      howToFix: safeString(
        record.howToFix,
        "建议补充具体证据并重写相关表达。",
      ),
      sampleWording: safeString(
        record.sampleWording,
        "可替换话术需结合项目实际数据补充。",
      ),
    }))
    .slice(0, 5);
}
