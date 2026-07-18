const PROFILE_TEXT_LIMIT = 30_000;
const MATURITY_EVIDENCE_TEXT_LIMIT = 50_000;
const MATURITY_KEYWORDS = [
  "技术方案",
  "体系架构",
  "功能模型",
  "仿真",
  "样机",
  "样件",
  "Demo",
  "MVP",
  "实验室",
  "测试",
  "验证",
  "模拟环境",
  "相关环境",
  "实际环境",
  "生产现场",
  "操作现场",
  "客户现场",
  "试用",
  "试点",
  "接入",
  "运行",
  "产品定型",
  "技术资料归档",
  "小批试产",
  "生产条件",
  "认证",
  "型式认可",
  "市场准入",
  "检测合格",
  "验收",
  "使用证明",
  "稳定运行",
  "量产",
  "批量生产",
  "批量交付",
  "全面应用",
  "销售回款",
] as const;

function extractMaturityWindows(sourceText: string) {
  const lowerText = sourceText.toLowerCase();
  const windows: Array<{ start: number; text: string; score: number }> = [];

  for (const keyword of MATURITY_KEYWORDS) {
    const lowerKeyword = keyword.toLowerCase();
    let fromIndex = 0;

    while (fromIndex < lowerText.length) {
      const index = lowerText.indexOf(lowerKeyword, fromIndex);

      if (index < 0) break;

      const start = Math.max(0, index - 220);
      const end = Math.min(sourceText.length, index + keyword.length + 480);
      const text = sourceText.slice(start, end).trim();
      const existing = windows.find(
        (item) =>
          Math.abs(item.start - start) < 180 || item.text.includes(text),
      );

      if (existing) existing.score += 1;
      else if (text) windows.push({ start, text, score: 1 });

      fromIndex = index + lowerKeyword.length;
    }
  }

  return windows
    .sort((left, right) => right.score - left.score || left.start - right.start)
    .map((item) => item.text);
}

export function buildLayeredRecognitionInput(
  fileName: string,
  sourceText: string,
) {
  const profileText = sourceText.slice(0, PROFILE_TEXT_LIMIT);
  const selectedWindows: string[] = [];
  let remaining = MATURITY_EVIDENCE_TEXT_LIMIT;

  for (const window of extractMaturityWindows(sourceText)) {
    if (remaining <= 0) break;

    const selected = window.slice(0, remaining);
    selectedWindows.push(selected);
    remaining -= selected.length;
  }

  return [
    `【文件：${fileName}】`,
    "【项目基础信息区：材料前部】",
    profileText,
    "【TRL 成熟度证据区：从全文检索得到，位置不限于材料前部】",
    selectedWindows.join("\n\n---\n\n") || "未检索到明确成熟度证据片段。",
  ].join("\n\n");
}
