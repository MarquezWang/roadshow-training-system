export const MAX_JSON_BODY_BYTES = 256 * 1024;
export const MAX_PROFILE_RECOGNITION_BODY_BYTES = 16 * 1024;
export const MAX_PROJECT_NAME_LENGTH = 100;
export const MAX_PROJECT_SUMMARY_LENGTH = 1_000;
export const MAX_PROJECT_DETAIL_LENGTH = 5_000;
export const MAX_PROJECT_CONTACT_LENGTH = 100;
export const MAX_MANUAL_TRANSCRIPT_LENGTH = 100_000;
export const MAX_ANSWER_TEXT_LENGTH = 100_000;
export const MAX_MATERIAL_TOKEN_LENGTH = 64;

export class RequestBodyTooLargeError extends Error {
  constructor(maxBytes: number) {
    super(`请求正文不能超过 ${maxBytes} 字节。`);
    this.name = "RequestBodyTooLargeError";
  }
}

export class InvalidJsonBodyError extends Error {
  constructor() {
    super("请求正文必须是合法 JSON。");
    this.name = "InvalidJsonBodyError";
  }
}

export function assertTextLength(
  value: string,
  fieldName: string,
  maxLength: number,
) {
  if (value.length > maxLength) {
    throw new Error(`${fieldName}不能超过 ${maxLength} 个字符。`);
  }

  return value;
}

async function readLimitedBody(
  request: Request,
  maxBytes: number,
) {
  const contentLength = request.headers.get("content-length");
  const declaredLength = contentLength === null ? null : Number(contentLength);

  if (
    declaredLength !== null &&
    Number.isFinite(declaredLength) &&
    declaredLength > maxBytes
  ) {
    throw new RequestBodyTooLargeError(maxBytes);
  }

  if (!request.body) return "";

  const reader = request.body.getReader();
  const decoder = new TextDecoder();
  let receivedBytes = 0;
  let rawBody = "";

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      receivedBytes += value.byteLength;
      if (receivedBytes > maxBytes) {
        await reader.cancel().catch(() => undefined);
        throw new RequestBodyTooLargeError(maxBytes);
      }

      rawBody += decoder.decode(value, { stream: true });
    }
    rawBody += decoder.decode();
  } finally {
    reader.releaseLock();
  }

  return rawBody;
}

export async function readLimitedJson<T>(
  request: Request,
  maxBytes = MAX_JSON_BODY_BYTES,
): Promise<T> {
  const rawBody = await readLimitedBody(request, maxBytes);

  try {
    return JSON.parse(rawBody) as T;
  } catch {
    throw new InvalidJsonBodyError();
  }
}

export async function readOptionalLimitedJson<T>(
  request: Request,
  fallback: T,
  maxBytes = MAX_JSON_BODY_BYTES,
): Promise<T> {
  const rawBody = await readLimitedBody(request, maxBytes);
  if (!rawBody.trim()) return fallback;

  try {
    return JSON.parse(rawBody) as T;
  } catch {
    throw new InvalidJsonBodyError();
  }
}
