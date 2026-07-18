import { isRecord } from "@/lib/type-guards";
import { assertNonEmptyString } from "./primitives";
import type {
  Evidence,
  EvidenceStrength,
  RiskLevel,
  UnsupportedNumericClaimField,
} from "./types";

const FACT_PATTERN =
  /(\d+(\.\d+)?\s*(年|月|日|万元|亿元|元|%|％|亩|项|件|个|家|省|市|页|轮|次|吨|公斤|kg|KG|m²|㎡|万|亿)?)|([一二三四五六七八九十百千万亿]+(年|月|项|件|个|家|省|市|轮|次))/;
export const NORMALIZED_MISSING_EVIDENCE_TEXT = "材料未提供相关证据。";

export function parseEvidence(value: unknown, fieldName: string): Evidence {
  if (!isRecord(value)) {
    throw new Error(`评分 JSON 字段 ${fieldName} 必须是对象。`);
  }

  return {
    evidenceText: assertNonEmptyString(
      value.evidenceText,
      `${fieldName}.evidenceText`,
    ),
    evidenceLocation:
      typeof value.evidenceLocation === "string"
        ? value.evidenceLocation.trim()
        : "",
  };
}

export function parseEvidenceStrength(
  value: unknown,
  fieldName: string,
): EvidenceStrength {
  if (value === undefined || value === null) {
    throw new Error(`评分 JSON 字段 ${fieldName} 不能为空。`);
  }

  if (value !== "STRONG" && value !== "PARTIAL" && value !== "MISSING") {
    throw new Error(
      `评分 JSON 字段 ${fieldName} 必须是 STRONG、PARTIAL 或 MISSING。`,
    );
  }

  return value;
}

export function parseRiskLevel(value: unknown, fieldName: string): RiskLevel {
  if (value === undefined || value === null) {
    throw new Error(`评分 JSON 字段 ${fieldName} 不能为空。`);
  }

  if (
    value !== "LOW" &&
    value !== "MEDIUM" &&
    value !== "HIGH" &&
    value !== "UNKNOWN"
  ) {
    throw new Error(
      `评分 JSON 字段 ${fieldName} 必须是 LOW、MEDIUM、HIGH 或 UNKNOWN。`,
    );
  }

  return value;
}

function hasSpecificFact(text: string) {
  return FACT_PATTERN.test(text);
}

export function isMissingEvidenceText(text: string) {
  return /材料未提供|未提供相关证据|未提及|未说明|无法判断|依据不足/.test(text);
}

function hasUnsupportedNumericClaim(evidence: Evidence, text: string) {
  return (
    hasSpecificFact(text) &&
    (isMissingEvidenceText(evidence.evidenceText) ||
      !hasSpecificFact(evidence.evidenceText))
  );
}

export function normalizeUnsupportedNumericClaims(
  criterion: string,
  evidence: Evidence,
  fields: Record<UnsupportedNumericClaimField, string>,
) {
  const unsupportedFields: UnsupportedNumericClaimField[] = [];
  const normalizedFields = { ...fields };

  for (const field of Object.keys(fields) as UnsupportedNumericClaimField[]) {
    if (hasUnsupportedNumericClaim(evidence, fields[field])) {
      unsupportedFields.push(field);
    }
  }

  if (unsupportedFields.includes("reason")) {
    normalizedFields.reason = "材料证据不足，未采纳无依据的具体数字表述。";
  }
  if (unsupportedFields.includes("deductionReason")) {
    normalizedFields.deductionReason = "材料未提供可核验的具体数量依据。";
  }
  if (unsupportedFields.includes("suggestion")) {
    normalizedFields.suggestion =
      "补充可核验的数量、指标、客户、案例或测试结果依据。";
  }

  return {
    fields: normalizedFields,
    warning:
      unsupportedFields.length > 0
        ? {
            type: "normalizedUnsupportedNumericClaim" as const,
            criterion,
            fields: unsupportedFields,
          }
        : null,
  };
}
