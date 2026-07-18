import {
  evidenceStatuses,
  type EvidenceStatus,
} from "./constants";

export function asString(value: unknown, fallback = "") {
  return typeof value === "string" ? value.trim() : fallback;
}

export function asStringArray(value: unknown) {
  return Array.isArray(value)
    ? value
        .filter((item): item is string => typeof item === "string")
        .map((item) => item.trim())
        .filter(Boolean)
    : [];
}

export function asEvidenceStatus(value: unknown): EvidenceStatus {
  if (
    typeof value === "string" &&
    evidenceStatuses.includes(value as EvidenceStatus)
  ) {
    return value as EvidenceStatus;
  }

  return "UNKNOWN";
}
