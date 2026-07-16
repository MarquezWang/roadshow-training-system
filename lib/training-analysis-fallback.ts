export type TrainingAnalysisFallbackReason =
  | "NO_ANALYZABLE_TEXT"
  | "AI_EMPTY_CONTENT"
  | "STRUCTURED_OUTPUT_INVALID";

export function isFallbackTrainingAnalysis(input: {
  isFallback?: boolean | null;
  fallbackReason?: string | null;
  summary: string;
  errorMessage: string | null;
  rawResultJson: string | null;
}) {
  if (input.fallbackReason?.trim()) {
    return true;
  }

  if (typeof input.isFallback === "boolean") {
    return input.isFallback;
  }

  // Transitional support for records serialized before explicit fallback
  // metadata existed. Current database records always use isFallback.
  const fallbackText = [
    input.summary,
    input.errorMessage ?? "",
    input.rawResultJson ?? "",
  ].join("\n");

  return /降级|基础报告|结构化\s*(?:JSON\s*)?(?:解析失败|输出不符合)|转写文本不可用|AI\s*未返回有效内容|fallback/i.test(
    fallbackText,
  );
}
