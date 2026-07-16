function bytesToBase64Url(bytes) {
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }

  return btoa(binary)
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replaceAll("=", "");
}

function base64UrlToBytes(value) {
  const padded = value
    .replaceAll("-", "+")
    .replaceAll("_", "/")
    .padEnd(Math.ceil(value.length / 4) * 4, "=");
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);

  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }

  return bytes;
}

function encodeText(value) {
  return new TextEncoder().encode(value);
}

function decodeText(bytes) {
  return new TextDecoder().decode(bytes);
}

async function hmacSha256(value, secret) {
  const key = await crypto.subtle.importKey(
    "raw",
    encodeText(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign("HMAC", key, encodeText(value));
  return bytesToBase64Url(new Uint8Array(signature));
}

function safeEqual(first, second) {
  if (first.length !== second.length) {
    return false;
  }

  let diff = 0;
  for (let index = 0; index < first.length; index += 1) {
    diff |= first.charCodeAt(index) ^ second.charCodeAt(index);
  }
  return diff === 0;
}

function isSessionPayload(payload, nowSec) {
  return (
    payload !== null &&
    typeof payload === "object" &&
    typeof payload.userId === "string" &&
    typeof payload.username === "string" &&
    (payload.sessionVersion === undefined ||
      (typeof payload.sessionVersion === "number" &&
        Number.isInteger(payload.sessionVersion) &&
        payload.sessionVersion >= 0)) &&
    typeof payload.exp === "number" &&
    Number.isInteger(payload.exp) &&
    payload.exp > nowSec
  );
}

export async function createSignedAuthCookieValue(payload, secret) {
  if (!secret) {
    throw new Error("An auth signing secret is required.");
  }

  const payloadValue = bytesToBase64Url(encodeText(JSON.stringify(payload)));
  const signature = await hmacSha256(payloadValue, secret);
  return `${payloadValue}.${signature}`;
}

export async function parseSignedAuthCookieValue(
  value,
  { currentSecret, previousSecret, nowSec = Math.floor(Date.now() / 1000) },
) {
  if (!value || !currentSecret) {
    return null;
  }

  const parts = value.split(".");
  if (parts.length !== 2 || !parts[0] || !parts[1]) {
    return null;
  }
  const [payloadValue, signature] = parts;

  let verifiedWith = null;
  const currentSignature = await hmacSha256(payloadValue, currentSecret);
  if (safeEqual(signature, currentSignature)) {
    verifiedWith = "current";
  } else if (previousSecret) {
    const previousSignature = await hmacSha256(payloadValue, previousSecret);
    if (safeEqual(signature, previousSignature)) {
      verifiedWith = "previous";
    }
  }

  if (!verifiedWith) {
    return null;
  }

  try {
    const payload = JSON.parse(decodeText(base64UrlToBytes(payloadValue)));
    if (!isSessionPayload(payload, nowSec)) {
      return null;
    }

    return {
      payload: {
        ...payload,
        sessionVersion: payload.sessionVersion ?? 0,
      },
      verifiedWith,
    };
  } catch {
    return null;
  }
}
