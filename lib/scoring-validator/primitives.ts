export function assertString(value: unknown, fieldName: string) {
  if (typeof value !== "string") {
    throw new Error(`评分 JSON 字段 ${fieldName} 必须是字符串。`);
  }

  return value;
}

export function assertNonEmptyString(value: unknown, fieldName: string) {
  const text = assertString(value, fieldName).trim();

  if (!text) {
    throw new Error(`评分 JSON 字段 ${fieldName} 不能为空。`);
  }

  return text;
}

export function assertInteger(value: unknown, fieldName: string) {
  if (typeof value !== "number" || !Number.isInteger(value)) {
    throw new Error(`评分 JSON 字段 ${fieldName} 必须是整数。`);
  }

  return value;
}

export function assertOptionalInteger(value: unknown, fieldName: string) {
  if (value === undefined || value === null) {
    return undefined;
  }

  return assertInteger(value, fieldName);
}

export function assertStringArray(value: unknown, fieldName: string) {
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) {
    throw new Error(`评分 JSON 字段 ${fieldName} 必须是字符串数组。`);
  }

  return value;
}

export function assertExactNumber(
  actual: number,
  expected: number,
  fieldName: string,
) {
  if (actual !== expected) {
    throw new Error(`${fieldName} 应为 ${expected}，当前为 ${actual}。`);
  }
}
