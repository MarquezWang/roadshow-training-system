import type { ProjectAIContext } from "./types";
import {
  PROJECT_CONTEXT_LEGACY_SCHEMA_VERSION,
  PROJECT_CONTEXT_SCHEMA_VERSION,
} from "@/lib/persisted-json-versions";

export function parseProjectAIContextSnapshot(
  value: string | null | undefined,
  schemaVersion?: string,
) {
  if (!value) {
    return null;
  }

  const normalizedVersion =
    schemaVersion?.trim() || PROJECT_CONTEXT_LEGACY_SCHEMA_VERSION;
  if (
    normalizedVersion !== PROJECT_CONTEXT_LEGACY_SCHEMA_VERSION &&
    normalizedVersion !== PROJECT_CONTEXT_SCHEMA_VERSION
  ) {
    return null;
  }

  try {
    const parsed = JSON.parse(value) as Partial<ProjectAIContext>;
    if (
      !parsed.project ||
      typeof parsed.project.id !== "string" ||
      !Array.isArray(parsed.files) ||
      !Array.isArray(parsed.criteria) ||
      !Array.isArray(parsed.expertComments) ||
      !Array.isArray(parsed.historicalQuestions)
    ) {
      return null;
    }

    return parsed as ProjectAIContext;
  } catch {
    return null;
  }
}
