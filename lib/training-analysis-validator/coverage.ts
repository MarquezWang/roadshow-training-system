import { isRecord } from "@/lib/type-guards";
import { safeString } from "./primitives";
import type { TrainingAnalysisResult } from "./types";

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

const COVERED_VALUES = new Set([
  "true",
  "false",
  "partial",
  "INSUFFICIENT",
]);
const DEFAULT_EVIDENCE = "未在当前材料或转写中提取到充分证据。";
const DEFAULT_SUGGESTION = "建议补充该部分内容。";

export function validateCoverage(
  value: unknown,
): TrainingAnalysisResult["contentCoverage"] {
  if (!Array.isArray(value)) {
    throw new Error("contentCoverage 必须是数组。");
  }

  const parsedItems = value.map((item, index) => {
    const record = isRecord(item) ? item : {};
    return {
      item: safeString(record.item, `coverage-item-${index}`),
      covered: (() => {
        const raw =
          typeof record.covered === "string" ? record.covered.trim() : "";
        if (COVERED_VALUES.has(raw)) {
          return raw as TrainingAnalysisResult["contentCoverage"][number]["covered"];
        }
        return "false" as const;
      })(),
      evidence: safeString(record.evidence, DEFAULT_EVIDENCE),
      suggestion: safeString(record.suggestion, DEFAULT_SUGGESTION),
    };
  });

  const existingMap = new Map<string, (typeof parsedItems)[number]>();
  for (const parsed of parsedItems) {
    const matched = COVERAGE_ITEMS.find(
      (standard) =>
        standard === parsed.item ||
        standard.includes(parsed.item) ||
        parsed.item.includes(standard),
    );
    if (matched && !existingMap.has(matched)) {
      existingMap.set(matched, parsed);
    } else if (!existingMap.has(parsed.item)) {
      existingMap.set(parsed.item, parsed);
    }
  }

  return COVERAGE_ITEMS.map((standardItem) => {
    const existing = existingMap.get(standardItem);
    if (existing) {
      return existing;
    }
    return {
      item: standardItem,
      covered: "INSUFFICIENT" as const,
      evidence: DEFAULT_EVIDENCE,
      suggestion: DEFAULT_SUGGESTION,
    };
  });
}
