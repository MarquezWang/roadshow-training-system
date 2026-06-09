export class AIJsonParseError extends Error {
  originalLength: number;
  extractedLength: number;
  parsePosition: number | null;

  constructor(
    message: string,
    details: {
      originalLength: number;
      extractedLength: number;
      parsePosition: number | null;
    },
  ) {
    super(message);
    this.name = "AIJsonParseError";
    this.originalLength = details.originalLength;
    this.extractedLength = details.extractedLength;
    this.parsePosition = details.parsePosition;
  }
}

function extractJsonCandidate(text: string) {
  const trimmedText = text.trim();

  if (!trimmedText) {
    return "";
  }

  const fencedJsonMatch =
    trimmedText.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i) ??
    trimmedText.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);

  if (fencedJsonMatch) {
    return fencedJsonMatch[1].trim();
  }

  const firstBraceIndex = trimmedText.indexOf("{");
  const lastBraceIndex = trimmedText.lastIndexOf("}");

  if (
    firstBraceIndex >= 0 &&
    lastBraceIndex > firstBraceIndex &&
    (firstBraceIndex !== 0 || lastBraceIndex !== trimmedText.length - 1)
  ) {
    return trimmedText.slice(firstBraceIndex, lastBraceIndex + 1).trim();
  }

  return trimmedText;
}

function extractParsePosition(message: string) {
  const match = message.match(/position\s+(\d+)/i);

  if (!match) {
    return null;
  }

  return Number(match[1]);
}

export function parseAIJson(text: string): unknown {
  const trimmedText = text.trim();
  const jsonText = extractJsonCandidate(trimmedText);

  if (!trimmedText) {
    throw new AIJsonParseError("AI 返回内容为空，无法解析 JSON。", {
      originalLength: 0,
      extractedLength: 0,
      parsePosition: null,
    });
  }

  try {
    return JSON.parse(jsonText);
  } catch (error) {
    const reason =
      error instanceof Error ? error.message : "未知 JSON 解析错误";
    const parsePosition = extractParsePosition(reason);
    const detailParts = [
      `原因：${reason}`,
      `原始文本长度：${trimmedText.length}`,
      `截取后文本长度：${jsonText.length}`,
    ];

    if (parsePosition !== null) {
      detailParts.push(`解析失败位置：${parsePosition}`);
    }

    throw new AIJsonParseError(
      `AI 返回内容不是合法 JSON：${detailParts.join("；")}。`,
      {
        originalLength: trimmedText.length,
        extractedLength: jsonText.length,
        parsePosition,
      },
    );
  }
}
