export function isFallbackTrainingAnalysis(input: {
  summary: string;
  errorMessage: string | null;
  rawResultJson: string | null;
}) {
  const fallbackText = [
    input.summary,
    input.errorMessage ?? "",
    input.rawResultJson ?? "",
  ].join("\n");

  return /降级|基础报告|结构化\s*(?:JSON\s*)?(?:解析失败|输出不符合)|转写文本不可用|AI\s*未返回有效内容|fallback/i.test(
    fallbackText,
  );
}
