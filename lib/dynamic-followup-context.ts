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

export function hasClearlyUnrelatedPitchContent(text: string) {
  const normalizedText = normalizeForProjectSignal(text);
  const unrelatedMarkers = [
    "不轻信",
    "不乱点",
    "不泄漏",
    "网上贷款",
    "刷单",
    "刷信誉",
    "刷流水",
    "先缴费",
    "验证码",
    "诈骗",
    "反诈",
    "杀猪盘",
    "中奖",
    "转账",
    "陌生链接",
    "不要相信",
    "防诈骗",
  ];

  return unrelatedMarkers.some((marker) =>
    normalizedText.includes(normalizeForProjectSignal(marker)),
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
  const isClearlyUnrelatedPitch =
    hasClearlyUnrelatedPitchContent(transcriptText) &&
    !pitchProjectContent.hasEnoughProjectPitchContent;

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
