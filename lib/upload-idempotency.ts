const IDEMPOTENCY_KEY_PATTERN = /^[a-zA-Z0-9._:-]+$/;
const MIN_IDEMPOTENCY_KEY_LENGTH = 16;
const MAX_IDEMPOTENCY_KEY_LENGTH = 128;

export class InvalidUploadIdempotencyKeyError extends Error {
  constructor(message = "上传幂等键无效，请刷新页面后重试。") {
    super(message);
    this.name = "InvalidUploadIdempotencyKeyError";
  }
}

export function normalizeUploadIdempotencyKey(value: unknown) {
  if (typeof value !== "string") {
    throw new InvalidUploadIdempotencyKeyError();
  }

  const key = value.trim();
  if (
    key.length < MIN_IDEMPOTENCY_KEY_LENGTH ||
    key.length > MAX_IDEMPOTENCY_KEY_LENGTH ||
    !IDEMPOTENCY_KEY_PATTERN.test(key)
  ) {
    throw new InvalidUploadIdempotencyKeyError();
  }

  return key;
}

export function readUploadIdempotencyKey(
  request: Request,
  formData?: FormData,
) {
  const headerValue = request.headers.get("Idempotency-Key");
  const formValue = formData?.get("idempotencyKey");
  return normalizeUploadIdempotencyKey(
    headerValue ?? (typeof formValue === "string" ? formValue : null),
  );
}
