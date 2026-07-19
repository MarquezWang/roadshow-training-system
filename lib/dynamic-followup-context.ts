type DynamicFollowupAIContext = {
  project?: {
    name?: string | null;
    summary?: string | null;
  } | null;
  files?: Array<{
    extractedText?: string | null;
  }>;
} | null;

export function buildDynamicFollowupProjectContext(
  aiContext: DynamicFollowupAIContext,
) {
  const projectName = aiContext?.project?.name ?? null;
  const projectDetailText = [
    aiContext?.project?.summary ?? "",
    ...(aiContext?.files ?? []).map((file) => file.extractedText ?? ""),
  ]
    .filter(Boolean)
    .join("\n");
  const projectContextText = [projectName ?? "", projectDetailText]
    .filter(Boolean)
    .join("\n");

  return {
    projectName,
    projectDetailText,
    projectContextText,
  };
}

function normalizeForProjectSignal(text: string) {
  return text.toLowerCase().replace(/\s+/g, "");
}

export function analyzePitchProjectContent(params: {
  text: string;
  projectName: string | null;
}) {
  const { text, projectName } = params;
  const normalizedText = normalizeForProjectSignal(text);
  const normalizedProjectName = projectName
    ? normalizeForProjectSignal(projectName)
    : "";
  const hasProjectNameInTranscript =
    normalizedProjectName.length >= 2 &&
    normalizedText.includes(normalizedProjectName);
  const projectSignals = [
    "技术",
    "产品",
    "方案",
    "客户",
    "市场",
    "团队",
    "商业模式",
    "收入",
    "融资",
    "专利",
    "测试",
    "指标",
    "试点",
    "落地",
    "应用场景",
    "痛点",
    "成本",
    "效率",
    "竞品",
    "合同",
    "订单",
  ];
  const matchedProjectSignals = projectSignals.filter((signal) =>
    normalizedText.includes(normalizeForProjectSignal(signal)),
  );
  const productOrServiceMarkers = [
    "产品",
    "系统",
    "平台",
    "服务",
    "方案",
    "工具",
    "应用",
    "软件",
    "硬件",
    "设备",
    "模型",
    "算法",
  ];
  const hasProductOrServiceMarker = productOrServiceMarkers.some((marker) =>
    normalizedText.includes(normalizeForProjectSignal(marker)),
  );
  const dimensionGroups = [
    ["技术", "算法", "模型", "研发", "专利", "测试", "指标", "数据", "ai", "人工智能"],
    ["客户", "用户", "市场", "需求", "痛点", "竞品", "竞争", "场景"],
    ["商业模式", "收入", "营收", "收费", "付费", "融资", "成本", "订单", "合同"],
    ["团队", "成员", "创始", "研发", "运营", "销售"],
    ["试点", "落地", "交付", "部署", "上线", "实施", "合作", "验证"],
  ];
  const matchedDimensionCount = dimensionGroups.filter((group) =>
    group.some((marker) =>
      normalizedText.includes(normalizeForProjectSignal(marker)),
    ),
  ).length;

  return {
    hasProjectNameInTranscript,
    matchedProjectSignals,
    hasEnoughProjectPitchContent:
      hasProjectNameInTranscript ||
      matchedProjectSignals.length >= 3 ||
      (hasProductOrServiceMarker && matchedDimensionCount >= 2),
  };
}

const COMMON_CONTEXT_BIGRAMS = new Set([
  "我们",
  "项目",
  "这个",
  "可以",
  "通过",
  "进行",
  "以及",
  "已经",
  "目前",
  "一个",
  "系统",
  "平台",
  "产品",
  "服务",
  "方案",
  "技术",
  "用户",
]);

function contextBigrams(text: string) {
  const normalized = normalizeForProjectSignal(text).replace(
    /[^\p{L}\p{N}]/gu,
    "",
  );
  const result = new Set<string>();

  for (let index = 0; index < normalized.length - 1; index += 1) {
    const part = normalized.slice(index, index + 2);
    if (!COMMON_CONTEXT_BIGRAMS.has(part)) result.add(part);
  }

  return result;
}

export function hasProjectContextOverlap(text: string, projectContextText: string) {
  const pitchParts = contextBigrams(text);
  const contextParts = contextBigrams(projectContextText);
  if (pitchParts.size === 0 || contextParts.size === 0) return false;

  const overlap = [...pitchParts].filter((part) => contextParts.has(part)).length;
  return overlap >= 4 && overlap / Math.min(pitchParts.size, 80) >= 0.06;
}

export function hasClearlyUnrelatedPitchContent(
  text: string,
  projectContextText = "",
) {
  return (
    projectContextText.replace(/\s+/g, "").length >= 80 &&
    !hasProjectContextOverlap(text, projectContextText)
  );
}

export function evaluateDynamicFollowupPreflight(params: {
  aiContext: DynamicFollowupAIContext;
  projectDetailText: string;
  projectName: string | null;
  transcriptText: string;
}) {
  const { aiContext, projectDetailText, projectName, transcriptText } = params;
  const pitchProjectContent = analyzePitchProjectContent({
    text: transcriptText,
    projectName,
  });
  const projectDetailLength = projectDetailText.replace(/\s+/g, "").length;
  const hasSparseProjectContext =
    !aiContext ||
    (projectDetailLength < 80 && (aiContext.files ?? []).length === 0);
  const projectContextText = [projectName ?? "", projectDetailText]
    .filter(Boolean)
    .join("\n");
  const isClearlyUnrelatedPitch =
    !pitchProjectContent.hasEnoughProjectPitchContent &&
    hasClearlyUnrelatedPitchContent(transcriptText, projectContextText);

  return {
    pitchProjectContent,
    hasSparseProjectContext,
    isClearlyUnrelatedPitch,
    shouldSkip:
      (hasSparseProjectContext &&
        !pitchProjectContent.hasEnoughProjectPitchContent) ||
      isClearlyUnrelatedPitch,
  };
}
