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

const coveredValues = new Set(["true", "false", "partial", "INSUFFICIENT"]);

export type QaReview = {
  questionId: string;
  questionIndex: number;
  dimension: "TECHNICAL" | "MARKET" | "RISK" | "FINANCE" | "TEAM" | "OTHER";
  question: string;
  judgeIntent: string;
  answerSummary: string;
  responseQuality: "GOOD" | "PARTIAL" | "WEAK";
  responseQualityLabel: string;
  missingPoints: string[];
  evidenceUse: string;
  improvementAdvice: string;
  betterAnswerOutline: string[];
};

export type DynamicFollowupReview = {
  questionId: string;
  question: string;
  answerSummary: string;
  targetWeakness: string;
  evidenceSupplement: string;
  improvementAdvice: string;
};

export type ReportOnePageSummary = {
  conclusion: string;
  strongestPoint: string;
  biggestWeakness: string;
  nextTrainingFocus: string;
  readinessAdvice: string;
};

export type ReportDiagnostics = {
  content: string[];
  delivery: string[];
  qa: string[];
};

export type ReportActionItem = {
  issue: string;
  whyItMatters: string;
  howToFix: string;
  sampleWording: string;
};

export type TrainingAnalysisResult = {
  overallScore: number;
  summary: string;
  strengths: string[];
  weaknesses: string[];
  suggestions: string[];
  onePageSummary?: ReportOnePageSummary;
  diagnostics?: ReportDiagnostics;
  actionItems?: ReportActionItem[];
  nextTrainingTasks?: string[];
  contentCoverage: Array<{
    item: string;
    covered: "true" | "false" | "partial" | "INSUFFICIENT";
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
  qaReviews?: QaReview[];
  dynamicFollowupReview?: DynamicFollowupReview | null;
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

  const result = value
    .filter((item): item is string => typeof item === "string" && item.trim().length > 0)
    .map((item) => item.trim());

  if (options.min !== undefined && result.length < options.min) {
    // 容错：不足最小数量时不抛错，仅返回已有项
    console.warn(
      `[validator] ${fieldName} 期望至少 ${options.min} 条，实际 ${result.length} 条，已降级接受。`,
    );
  }

  if (options.max !== undefined && result.length > options.max) {
    // 截断超出项
    console.warn(
      `[validator] ${fieldName} 期望最多 ${options.max} 条，实际 ${result.length} 条，已截断。`,
    );
    return result.slice(0, options.max);
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

  const DEFAULT_EVIDENCE = "未在当前材料或转写中提取到充分证据。";
  const DEFAULT_SUGGESTION = "建议补充该部分内容。";

  // 解析已有的 coverage 项，容错处理缺失字段
  const parsedItems = value.map((item, index) => {
    const record = isRecord(item) ? item : {};
    return {
      item: safeString(record.item, `coverage-item-${index}`),
      covered: (() => {
        const raw = typeof record.covered === "string" ? record.covered.trim() : "";
        if (coveredValues.has(raw)) return raw as "true" | "false" | "partial";
        return "false";
      })(),
      evidence: safeString(record.evidence, DEFAULT_EVIDENCE),
      suggestion: safeString(record.suggestion, DEFAULT_SUGGESTION),
    };
  });

  // 构建已有项的映射（item → 已有数据），优先匹配标准项名称
  const existingMap = new Map<string, (typeof parsedItems)[number]>();
  for (const parsed of parsedItems) {
    // 尝试匹配标准项
    const matched = coverageItems.find(
      (std) => std === parsed.item || std.includes(parsed.item) || parsed.item.includes(std),
    );
    if (matched && !existingMap.has(matched)) {
      existingMap.set(matched, parsed);
    } else if (!existingMap.has(parsed.item)) {
      existingMap.set(parsed.item, parsed);
    }
  }

  // 按标准项顺序构建最终结果，缺失项自动补齐
  const result = coverageItems.map((standardItem) => {
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

  return result;
}

function normalizeDimension(raw: string): QaReview["dimension"] {
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

function normalizeResponseQuality(raw: string): QaReview["responseQuality"] {
  const normalized = raw.trim().toUpperCase();
  if (normalized === "GOOD") return "GOOD";
  if (normalized === "PARTIAL") return "PARTIAL";
  return "WEAK";
}

function safeString(value: unknown, fallback: string): string {
  if (typeof value === "string" && value.trim()) return value.trim();
  return fallback;
}

function safeStringArray(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.filter((item): item is string => typeof item === "string" && item.trim().length > 0);
  }
  return [];
}

function validateQaReviews(value: unknown): QaReview[] | undefined {
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

      return {
        questionId: safeString(
          record.questionId,
          `auto-q${index + 1}`,
        ),
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
        responseQuality: normalizeResponseQuality(rawQuality),
        responseQualityLabel: safeString(
          record.responseQualityLabel,
          normalizeResponseQuality(rawQuality) === "GOOD"
            ? "回答良好"
            : normalizeResponseQuality(rawQuality) === "PARTIAL"
              ? "部分回答"
              : "回答偏弱",
        ),
        missingPoints: safeStringArray(record.missingPoints),
        evidenceUse: safeString(
          record.evidenceUse,
          "未能提供有效证据。",
        ),
        improvementAdvice: safeString(
          record.improvementAdvice,
          "建议围绕问题要点针对性作答。",
        ),
        betterAnswerOutline: safeStringArray(
          record.betterAnswerOutline,
        ),
      };
    });
}

function validateDynamicFollowupReview(
  value: unknown,
): DynamicFollowupReview | null {
  if (value === undefined || value === null) {
    return null;
  }

  if (!isRecord(value)) {
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

function validateOnePageSummary(
  value: unknown,
  fallback: {
    summary: string;
    strengths: string[];
    weaknesses: string[];
    suggestions: string[];
  },
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

function validateDiagnostics(value: unknown): ReportDiagnostics {
  const record = isRecord(value) ? value : {};

  return {
    content: safeStringArray(record.content).slice(0, 4),
    delivery: safeStringArray(record.delivery).slice(0, 4),
    qa: safeStringArray(record.qa).slice(0, 4),
  };
}

function validateActionItems(value: unknown): ReportActionItem[] {
  if (!Array.isArray(value)) return [];

  return value
    .filter((item): item is Record<string, unknown> => isRecord(item))
    .map((record): ReportActionItem => ({
      issue: safeString(record.issue, "待优化问题暂未明确。"),
      whyItMatters: safeString(
        record.whyItMatters,
        "该问题会影响评委对项目价值和可信度的判断。",
      ),
      howToFix: safeString(record.howToFix, "建议补充具体证据并重写相关表达。"),
      sampleWording: safeString(
        record.sampleWording,
        "可替换话术需结合项目实际数据补充。",
      ),
    }))
    .slice(0, 5);
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

  const summary = readString(analysis.summary, "summary");
  const strengths = readStringArray(analysis.strengths, "strengths", {
    max: 5,
  });
  const weaknesses = readStringArray(analysis.weaknesses, "weaknesses", {
    min: 3,
    max: 5,
  });
  const suggestions = readStringArray(analysis.suggestions, "suggestions", {
    max: 5,
  });

  return {
    overallScore,
    summary,
    strengths,
    weaknesses,
    suggestions,
    onePageSummary: validateOnePageSummary(analysis.onePageSummary, {
      summary,
      strengths,
      weaknesses,
      suggestions,
    }),
    diagnostics: validateDiagnostics(analysis.diagnostics),
    actionItems: validateActionItems(analysis.actionItems),
    nextTrainingTasks: readStringArray(
      analysis.nextTrainingTasks ?? suggestions,
      "nextTrainingTasks",
      {
        max: 5,
      },
    ),
    contentCoverage: validateCoverage(analysis.contentCoverage),
    timing: readObject(analysis.timing, "timing"),
    slideSync: readObject(analysis.slideSync, "slideSync"),
    riskQuestions: readStringArray(analysis.riskQuestions, "riskQuestions", {
      min: 3,
      max: 5,
    }),
    qaReviews: validateQaReviews(analysis.qaReviews),
    dynamicFollowupReview: validateDynamicFollowupReview(
      analysis.dynamicFollowupReview,
    ),
  };
}
