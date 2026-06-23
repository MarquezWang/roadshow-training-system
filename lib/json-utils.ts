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

function findBalancedJsonEnd(text: string, start: number) {
  const opening = text[start];
  const expectedClosing = opening === "{" ? "}" : "]";
  const stack = [expectedClosing];
  let inString = false;
  let escaped = false;

  for (let index = start + 1; index < text.length; index += 1) {
    const character = text[index];

    if (inString) {
      if (escaped) escaped = false;
      else if (character === "\\") escaped = true;
      else if (character === '"') inString = false;
      continue;
    }

    if (character === '"') {
      inString = true;
      continue;
    }

    if (character === "{") stack.push("}");
    else if (character === "[") stack.push("]");
    else if (character === "}" || character === "]") {
      if (stack.at(-1) !== character) return null;
      stack.pop();
      if (stack.length === 0) return index;
    }
  }

  return null;
}

function extractJsonCandidates(text: string) {
  const candidates = [text.trim()];

  for (let index = 0; index < text.length; index += 1) {
    if (text[index] !== "{" && text[index] !== "[") continue;

    const end = findBalancedJsonEnd(text, index);
    if (end !== null) candidates.push(text.slice(index, end + 1).trim());
  }

  return [...new Set(candidates.filter(Boolean))];
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

  if (!trimmedText) {
    throw new AIJsonParseError("AI 返回内容为空，无法解析 JSON。", {
      originalLength: 0,
      extractedLength: 0,
      parsePosition: null,
    });
  }

  const candidates = extractJsonCandidates(trimmedText);
  let firstError: unknown;

  for (const candidate of candidates) {
    try {
      return JSON.parse(candidate);
    } catch (error) {
      firstError ??= error;
    }
  }

  const reason =
    firstError instanceof Error ? firstError.message : "未知 JSON 解析错误";
  const parsePosition = extractParsePosition(reason);
  const extractedLength = candidates[1]?.length ?? candidates[0]?.length ?? 0;
  const detailParts = [
    `原因：${reason}`,
    `原始文本长度：${trimmedText.length}`,
    `候选 JSON 数量：${candidates.length}`,
    `首个候选长度：${extractedLength}`,
  ];

  if (parsePosition !== null) {
    detailParts.push(`解析失败位置：${parsePosition}`);
  }

  throw new AIJsonParseError(
    `AI 返回内容不是合法 JSON：${detailParts.join("；")}。`,
    {
      originalLength: trimmedText.length,
      extractedLength,
      parsePosition,
    },
  );
}

export function parseFirstAIJsonObject(
  text: string,
): Record<string, unknown> {
  const trimmedText = text.trim();

  if (!trimmedText) {
    throw new AIJsonParseError("AI 返回内容为空，无法解析 JSON 对象。", {
      originalLength: 0,
      extractedLength: 0,
      parsePosition: null,
    });
  }

  const candidates = extractJsonCandidates(trimmedText);
  let firstError: unknown;

  for (const candidate of candidates) {
    try {
      const parsed = JSON.parse(candidate) as unknown;

      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>;
      }
    } catch (error) {
      firstError ??= error;
    }
  }

  const reason =
    firstError instanceof Error
      ? firstError.message
      : "未找到合法 JSON 对象";
  throw new AIJsonParseError(`AI 返回内容无法提取 JSON 对象：${reason}。`, {
    originalLength: trimmedText.length,
    extractedLength: candidates[1]?.length ?? candidates[0]?.length ?? 0,
    parsePosition: extractParsePosition(reason),
  });
}
