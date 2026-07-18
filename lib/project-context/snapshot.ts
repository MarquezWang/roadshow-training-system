import type { ProjectAIContext } from "./types";

export function parseProjectAIContextSnapshot(
  value: string | null | undefined,
) {
  if (!value) {
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
