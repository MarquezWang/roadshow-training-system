import { createHash, createHmac, randomUUID } from "crypto";

const TENCENT_TTS_ENDPOINT = "tts.tencentcloudapi.com";
const TENCENT_TTS_SERVICE = "tts";
const TENCENT_TTS_VERSION = "2019-08-23";

type TencentTtsConfig = {
  secretId: string;
  secretKey: string;
  region: string;
  endpoint: string;
};

type TencentTtsResponse = {
  Response?: {
    Audio?: string;
    SessionId?: string;
    RequestId?: string;
    Error?: {
      Code?: string;
      Message?: string;
    };
  };
};

type SynthesizeTencentTtsOptions = {
  text: string;
  voiceType: number;
  sessionId?: string;
};

function readRequiredEnv(primaryName: string, fallbackName?: string) {
  const value =
    process.env[primaryName]?.trim() ||
    (fallbackName ? process.env[fallbackName]?.trim() : "");

  if (!value) {
    throw new Error(`未配置腾讯云 TTS 环境变量：${primaryName}`);
  }

  return value;
}

function getTencentTtsConfig(): TencentTtsConfig {
  return {
    secretId: readRequiredEnv("TENCENT_SECRET_ID", "TENCENTCLOUD_SECRET_ID"),
    secretKey: readRequiredEnv(
      "TENCENT_SECRET_KEY",
      "TENCENTCLOUD_SECRET_KEY",
    ),
    region: process.env.TENCENT_TTS_REGION?.trim() || "ap-guangzhou",
    endpoint: process.env.TENCENT_TTS_ENDPOINT?.trim() || TENCENT_TTS_ENDPOINT,
  };
}

function sha256Hex(value: string) {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function hmacSha256(key: Buffer | string, value: string) {
  return createHmac("sha256", key).update(value, "utf8").digest();
}

function formatUtcDate(timestampSec: number) {
  return new Date(timestampSec * 1000).toISOString().slice(0, 10);
}

async function callTencentTtsApi(
  payload: Record<string, unknown>,
  config: TencentTtsConfig,
) {
  const timestamp = Math.floor(Date.now() / 1000);
  const date = formatUtcDate(timestamp);
  const body = JSON.stringify(payload);
  const contentType = "application/json; charset=utf-8";
  const canonicalHeaders =
    `content-type:${contentType}\n` + `host:${config.endpoint}\n`;
  const signedHeaders = "content-type;host";
  const canonicalRequest = [
    "POST",
    "/",
    "",
    canonicalHeaders,
    signedHeaders,
    sha256Hex(body),
  ].join("\n");
  const credentialScope = `${date}/${TENCENT_TTS_SERVICE}/tc3_request`;
  const stringToSign = [
    "TC3-HMAC-SHA256",
    String(timestamp),
    credentialScope,
    sha256Hex(canonicalRequest),
  ].join("\n");
  const secretDate = hmacSha256(`TC3${config.secretKey}`, date);
  const secretService = hmacSha256(secretDate, TENCENT_TTS_SERVICE);
  const secretSigning = hmacSha256(secretService, "tc3_request");
  const signature = createHmac("sha256", secretSigning)
    .update(stringToSign, "utf8")
    .digest("hex");
  const authorization =
    `TC3-HMAC-SHA256 Credential=${config.secretId}/${credentialScope}, ` +
    `SignedHeaders=${signedHeaders}, Signature=${signature}`;

  const response = await fetch(`https://${config.endpoint}`, {
    method: "POST",
    headers: {
      Authorization: authorization,
      "Content-Type": contentType,
      Host: config.endpoint,
      "X-TC-Action": "TextToVoice",
      "X-TC-Version": TENCENT_TTS_VERSION,
      "X-TC-Timestamp": String(timestamp),
      "X-TC-Region": config.region,
    },
    body,
  });
  const rawText = await response.text();
  let parsed: TencentTtsResponse;

  try {
    parsed = JSON.parse(rawText) as TencentTtsResponse;
  } catch {
    throw new Error(`腾讯云 TTS 返回非 JSON：HTTP ${response.status}`);
  }

  const apiError = parsed.Response?.Error;

  if (!response.ok || apiError) {
    throw new Error(
      `腾讯云 TTS TextToVoice 失败：${
        apiError?.Message ?? `HTTP ${response.status}`
      }`,
    );
  }

  if (!parsed.Response?.Audio) {
    throw new Error("腾讯云 TTS 响应缺少 Audio。");
  }

  return {
    audio: parsed.Response.Audio,
    requestId: parsed.Response.RequestId ?? null,
    sessionId: parsed.Response.SessionId ?? null,
  };
}

export async function synthesizeTencentTts({
  text,
  voiceType,
  sessionId,
}: SynthesizeTencentTtsOptions) {
  const config = getTencentTtsConfig();
  const result = await callTencentTtsApi(
    {
      Text: text,
      SessionId: sessionId ?? randomUUID(),
      ModelType: 1,
      VoiceType: voiceType,
      PrimaryLanguage: 1,
      SampleRate: 16000,
      Codec: "mp3",
    },
    config,
  );

  return {
    audioBuffer: Buffer.from(result.audio, "base64"),
    requestId: result.requestId,
    sessionId: result.sessionId,
  };
}
