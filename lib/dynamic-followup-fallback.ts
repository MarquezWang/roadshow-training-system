const PROJECT_CONTENT_KEYWORDS = [
  "项目",
  "系统",
  "产品",
  "平台",
  "模块",
  "已完成",
  "原型",
  "测试",
  "试用",
  "客户",
  "用户",
  "商业模式",
  "落地",
  "数据",
  "指标",
  "验证",
  "动态追问",
  "自动转写",
  "模拟答辩",
  "训练报告",
  "没有讲透",
  "证据支撑",
] as const;

const MIN_CONTENT_PITCH_CHARS = 120;

export function evaluateContentFallbackEligibility(transcriptText: string) {
  const matchedKeywords = PROJECT_CONTENT_KEYWORDS.filter((kw) =>
    transcriptText.includes(kw),
  );
  const hasPitchProjectContent = matchedKeywords.length > 0;

  return {
    matchedKeywords,
    hasPitchProjectContent,
    shouldAttemptContentFallback:
      transcriptText.length >= MIN_CONTENT_PITCH_CHARS &&
      hasPitchProjectContent,
  };
}
