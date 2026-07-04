export function parseJsonArray<T>(value: string | null | undefined): T[] {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function parseJsonObject(
  value: string | null | undefined,
): Record<string, unknown> {
  if (!value) return {};
  try {
    const parsed = JSON.parse(value);
    return typeof parsed === "object" &&
      parsed !== null &&
      !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

export function parseDynamicFollowupReview(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  const record = value as Record<string, unknown>;
  const readString = (key: string) =>
    typeof record[key] === "string" ? record[key] : "";

  return {
    questionId: readString("questionId"),
    question: readString("question"),
    answerSummary: readString("answerSummary"),
    targetWeakness: readString("targetWeakness"),
    evidenceSupplement: readString("evidenceSupplement"),
    improvementAdvice: readString("improvementAdvice"),
  };
}

export function parseOnePageSummary(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  const record = value as Record<string, unknown>;
  const readString = (key: string) =>
    typeof record[key] === "string" ? record[key] : "";

  return {
    conclusion: readString("conclusion"),
    strongestPoint: readString("strongestPoint"),
    biggestWeakness: readString("biggestWeakness"),
    nextTrainingFocus: readString("nextTrainingFocus"),
    readinessAdvice: readString("readinessAdvice"),
  };
}

export function parseDiagnostics(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  const record = value as Record<string, unknown>;
  const readStringArray = (key: string) =>
    Array.isArray(record[key])
      ? (record[key] as unknown[]).filter(
          (item): item is string =>
            typeof item === "string" && item.trim().length > 0,
        )
      : [];

  return {
    content: readStringArray("content"),
    delivery: readStringArray("delivery"),
    qa: readStringArray("qa"),
  };
}

export function parseActionItems(value: unknown) {
  if (!Array.isArray(value)) return [];

  return value
    .filter(
      (item): item is Record<string, unknown> =>
        Boolean(item && typeof item === "object" && !Array.isArray(item)),
    )
    .map((record) => {
      const readString = (key: string) =>
        typeof record[key] === "string" ? record[key] : "";

      return {
        issue: readString("issue"),
        whyItMatters: readString("whyItMatters"),
        howToFix: readString("howToFix"),
        sampleWording: readString("sampleWording"),
      };
    });
}
