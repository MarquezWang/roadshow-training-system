export function getQuestionTypeLabel(questionType: string | null) {
  const qType = questionType ?? "QUESTION";
  return qType === "TECH"
    ? "技术"
    : qType === "MARKET"
      ? "市场"
      : qType === "RISK"
        ? "风险"
        : qType === "TEAM"
          ? "团队"
          : qType === "FINANCE"
            ? "财务"
            : qType;
}

export function getQuestionDimensionHint(questionType: string | null) {
  const qType = questionType ?? "QUESTION";
  return qType === "TECH"
    ? "主要考察技术可行性"
    : qType === "MARKET"
      ? "主要考察市场判断"
      : qType === "RISK"
        ? "主要考察风险识别"
        : qType === "TEAM"
          ? "主要考察团队能力"
          : qType === "FINANCE"
            ? "主要考察财务模型"
            : "主要考察答辩应变能力";
}

export function getQualityColor(responseQuality: string | undefined) {
  return responseQuality === "GOOD"
    ? "bg-emerald-50 text-emerald-600"
    : responseQuality === "PARTIAL"
      ? "bg-amber-50 text-amber-600"
      : responseQuality === "WEAK"
        ? "bg-red-50 text-red-500"
        : "";
}
