const coverageItems = [
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

const coveredValues = new Set(["true", "false", "partial"]);

export type TrainingAnalysisResult = {
  overallScore: number;
  summary: string;
  strengths: string[];
  weaknesses: string[];
  suggestions: string[];
  contentCoverage: Array<{
    item: string;
    covered: "true" | "false" | "partial";
    evidence: string;
    suggestion: string;
  }>;
  timing: Record<string, unknown> & {
    durationSec?: number;
    targetDurationSec?: number;
    assessment?: string;
    opening?: string;
    middle?: string;
    ending?: string;
    suggestion?: string;
  };
  slideSync: Record<string, unknown> & {
    slideEventCount?: number;
    pageCount?: number;
    assessment?: string;
    frequentFlipRisk?: string;
    longStayRisk?: string;
    suggestion?: string;
  };
  riskQuestions: string[];
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function readString(value: unknown, fieldName: string) {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`${fieldName} 必须是非空字符串。`);
  }

  return value.trim();
}

function readStringArray(
  value: unknown,
  fieldName: string,
  options: {
    min?: number;
    max?: number;
  } = {},
) {
  if (!Array.isArray(value)) {
    throw new Error(`${fieldName} 必须是数组。`);
  }

  const result = value.map((item, index) =>
    readString(item, `${fieldName}[${index}]`),
  );

  if (options.min !== undefined && result.length < options.min) {
    throw new Error(`${fieldName} 至少需要 ${options.min} 条。`);
  }

  if (options.max !== undefined && result.length > options.max) {
    throw new Error(`${fieldName} 最多允许 ${options.max} 条。`);
  }

  return result;
}

function readObject(value: unknown, fieldName: string) {
  if (!isRecord(value)) {
    throw new Error(`${fieldName} 必须是对象。`);
  }

  return value;
}

function validateCoverage(value: unknown) {
  if (!Array.isArray(value)) {
    throw new Error("contentCoverage 必须是数组。");
  }

  if (value.length !== coverageItems.length) {
    throw new Error(`contentCoverage 必须包含 ${coverageItems.length} 项。`);
  }

  const result = value.map((item, index) => {
    const record = readObject(item, `contentCoverage[${index}]`);
    const coverageItem = readString(record.item, `contentCoverage[${index}].item`);
    const covered = readString(
      record.covered,
      `contentCoverage[${index}].covered`,
    );

    if (!coveredValues.has(covered)) {
      throw new Error(
        `contentCoverage[${index}].covered 只能是 true、false 或 partial。`,
      );
    }

    return {
      item: coverageItem,
      covered: covered as "true" | "false" | "partial",
      evidence: readString(
        record.evidence,
        `contentCoverage[${index}].evidence`,
      ),
      suggestion: readString(
        record.suggestion,
        `contentCoverage[${index}].suggestion`,
      ),
    };
  });

  const receivedItems = new Set(result.map((item) => item.item));
  const missingItems = coverageItems.filter((item) => !receivedItems.has(item));

  if (missingItems.length > 0) {
    throw new Error(`contentCoverage 缺少覆盖项：${missingItems.join("、")}。`);
  }

  return result;
}

export function validateTrainingAnalysisResult(
  analysisJson: unknown,
): TrainingAnalysisResult {
  const analysis = readObject(analysisJson, "analysisJson");
  const overallScore = Number(analysis.overallScore);

  if (
    !Number.isInteger(overallScore) ||
    overallScore < 0 ||
    overallScore > 100
  ) {
    throw new Error("overallScore 必须是 0 到 100 的整数。");
  }

  return {
    overallScore,
    summary: readString(analysis.summary, "summary"),
    strengths: readStringArray(analysis.strengths, "strengths", {
      max: 5,
    }),
    weaknesses: readStringArray(analysis.weaknesses, "weaknesses", {
      min: 3,
      max: 5,
    }),
    suggestions: readStringArray(analysis.suggestions, "suggestions", {
      max: 5,
    }),
    contentCoverage: validateCoverage(analysis.contentCoverage),
    timing: readObject(analysis.timing, "timing"),
    slideSync: readObject(analysis.slideSync, "slideSync"),
    riskQuestions: readStringArray(analysis.riskQuestions, "riskQuestions", {
      min: 3,
      max: 5,
    }),
  };
}
