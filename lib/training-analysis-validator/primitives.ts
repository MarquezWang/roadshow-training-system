import { isRecord } from "@/lib/type-guards";

export function readString(value: unknown, fieldName: string) {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`${fieldName} 必须是非空字符串。`);
  }

  return value.trim();
}

export function readStringArray(
  value: unknown,
  fieldName: string,
  options: {
    min?: number;
    max?: number;
  } = {},
) {
  if (!Array.isArray(value)) {
    throw new Error(`${fieldName} 必须是数组。`);
  }

  const result = value
    .filter(
      (item): item is string =>
        typeof item === "string" && item.trim().length > 0,
    )
    .map((item) => item.trim());

  if (options.min !== undefined && result.length < options.min) {
    console.warn(
      `[validator] ${fieldName} 期望至少 ${options.min} 条，实际 ${result.length} 条，已降级接受。`,
    );
  }

  if (options.max !== undefined && result.length > options.max) {
    console.warn(
      `[validator] ${fieldName} 期望最多 ${options.max} 条，实际 ${result.length} 条，已截断。`,
    );
    return result.slice(0, options.max);
  }

  return result;
}

export function readObject(value: unknown, fieldName: string) {
  if (!isRecord(value)) {
    throw new Error(`${fieldName} 必须是对象。`);
  }

  return value;
}

export function safeString(value: unknown, fallback: string): string {
  if (typeof value === "string" && value.trim()) return value.trim();
  return fallback;
}

export function safeStringArray(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.filter(
      (item): item is string =>
        typeof item === "string" && item.trim().length > 0,
    );
  }
  return [];
}
