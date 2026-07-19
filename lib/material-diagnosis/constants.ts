export const evidenceStatuses = [
  "SUFFICIENT",
  "PARTIAL",
  "MISSING",
  "UNKNOWN",
] as const;

export const MATERIAL_DIAGNOSIS_SCHEMA_VERSION =
  "material-diagnosis-result:2026-07-19.1";
export const MATERIAL_DIAGNOSIS_LEGACY_SCHEMA_VERSION =
  "material-diagnosis-result:legacy-v0";
export const LEGACY_DIAGNOSIS_SCHEMA_VERSION = "diagnosis-result:legacy-v1";

export const readinessLevels = [
  "HIGH",
  "MEDIUM",
  "LOW",
  "INSUFFICIENT",
] as const;

export type EvidenceStatus = (typeof evidenceStatuses)[number];
export type ReadinessLevel = (typeof readinessLevels)[number];

export const EVIDENCE_SCORE_RATIO: Record<EvidenceStatus, number> = {
  SUFFICIENT: 1,
  PARTIAL: 0.6,
  MISSING: 0.25,
  UNKNOWN: 0,
};

export const readinessLevelLabel: Record<ReadinessLevel, string> = {
  HIGH: "材料准备度高",
  MEDIUM: "材料准备度中等",
  LOW: "材料准备度偏低",
  INSUFFICIENT: "材料证据不足",
};

export const evidenceStatusLabel: Record<EvidenceStatus, string> = {
  SUFFICIENT: "证据充分",
  PARTIAL: "部分充分",
  MISSING: "证据不足",
  UNKNOWN: "无法判断",
};
