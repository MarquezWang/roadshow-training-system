import { callAI } from "@/lib/ai";

export type ExtractedProjectProfile = {
  name: string;
  summary: string;
  field: string;
  applicationScenario: string;
  technicalKeywords: string[];
  productForm: string;
  trlLevel: number | null;
  trlReason: string;
  currentProgress: string;
};

const DEFAULT_PROFILE: ExtractedProjectProfile = {
  name: "",
  summary: "",
  field: "",
  applicationScenario: "",
  technicalKeywords: [],
  productForm: "",
  trlLevel: null,
  trlReason: "",
  currentProgress: "",
};

const MAX_PROFILE_SOURCE_LENGTH = 16_000;

function coerceString(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function coerceStringArray(value: unknown) {
  if (Array.isArray(value)) {
    return value
      .map((item) => coerceString(item))
      .filter(Boolean)
      .slice(0, 12);
  }

  const text = coerceString(value);

  if (!text) {
    return [];
  }

  return text
    .split(/[、,，;；\n]/)
    .map((item) => item.trim())
    .filter(Boolean)
    .slice(0, 12);
}

function coerceTrlLevel(value: unknown) {
  const numericValue = typeof value === "number" ? value : Number(value);

  if (!Number.isInteger(numericValue) || numericValue < 1 || numericValue > 9) {
    return null;
  }

  return numericValue;
}

function stripJsonFence(text: string) {
  return text
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/```$/i, "")
    .trim();
}

function parseProfileJson(text: string) {
  const cleaned = stripJsonFence(text);
  const firstBrace = cleaned.indexOf("{");
  const lastBrace = cleaned.lastIndexOf("}");

  if (firstBrace === -1 || lastBrace === -1 || lastBrace <= firstBrace) {
    throw new Error("AI 未返回可解析的 JSON 项目档案。");
  }

  return JSON.parse(cleaned.slice(firstBrace, lastBrace + 1)) as Record<string, unknown>;
}

function normalizeProfile(value: Record<string, unknown>): ExtractedProjectProfile {
  return {
    name: coerceString(value.name),
    summary: coerceString(value.summary),
    field: coerceString(value.field),
    applicationScenario: coerceString(value.applicationScenario),
    technicalKeywords: coerceStringArray(value.technicalKeywords),
    productForm: coerceString(value.productForm),
    trlLevel: coerceTrlLevel(value.trlLevel),
    trlReason: coerceString(value.trlReason),
    currentProgress: coerceString(value.currentProgress),
  };
}

export function formatTrlStage(trlLevel: number | null) {
  return trlLevel ? `TRL ${trlLevel}` : "";
}

export async function extractProjectProfileFromText(
  fileName: string,
  extractedText: string,
): Promise<ExtractedProjectProfile> {
  const sourceText = extractedText.trim().slice(0, MAX_PROFILE_SOURCE_LENGTH);

  if (!sourceText) {
    return DEFAULT_PROFILE;
  }

  const result = await callAI({
    temperature: 0.1,
    maxOutputTokens: 1_500,
    systemPrompt:
      "你是科技项目路演材料分析助手。请只根据用户提供的材料文本提取项目信息，不要编造。必须返回严格 JSON，不要输出 Markdown 或解释。",
    userPrompt: `请从以下路演材料中提取项目建档信息。\n\n要求：\n1. 项目名称、领域、应用场景、技术关键词、产品形态、TRL 成熟度均只能依据材料判断。\n2. TRL 成熟度取 1-9，无法判断则返回 null。\n3. 技术关键词返回数组，最多 12 个。\n4. 当前已有进展用于概括材料中能证明项目不是空想的进展，例如样机、Demo、测试、专利、试点、客户、订单、获奖、立项等；没有明确证据则留空。\n5. 不要提取团队/单位信息，也不要推断合作需求，这两项后续由用户手动填写。\n\n请返回以下 JSON：\n{\n  "name": "",\n  "summary": "",\n  "field": "",\n  "applicationScenario": "",\n  "technicalKeywords": [],\n  "productForm": "",\n  "trlLevel": null,\n  "trlReason": "",\n  "currentProgress": ""\n}\n\n文件名：${fileName}\n\n材料文本：\n${sourceText}`,
  });

  return normalizeProfile(parseProfileJson(result.text));
}
