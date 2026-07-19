import { stat } from "fs/promises";
import path from "path";
import { fetchWithFileBody } from "@/lib/http-file-stream.mjs";
import { throwIfTranscriptionAborted } from "@/lib/transcription-abort.mjs";
import {
  generateXfyunSigna,
  XFYUN_RESULT_URL,
  XFYUN_UPLOAD_URL,
} from "./config";
import { saveXfyunDebugJson, xfyunDebugLog } from "./debug";
import type {
  XfyunAudioInfo,
  XfyunConfig,
  XfyunResultBody,
  XfyunResultResponse,
  XfyunResultVariant,
  XfyunUploadResult,
} from "./types";

export async function uploadXfyunAudio(
  filePath: string,
  config: XfyunConfig,
  audioInfo: XfyunAudioInfo,
  debugDir: string,
  signal: AbortSignal,
): Promise<XfyunUploadResult> {
  const ts = Math.floor(Date.now() / 1000).toString();
  const signa = generateXfyunSigna(config.appId, ts, config.secretKey);
  const fileName = path.basename(filePath);
  throwIfTranscriptionAborted(signal);
  const fileInfo = await stat(/* turbopackIgnore: true */ filePath);
  const fileSize = fileInfo.size;
  const durationMs = Math.round(audioInfo.durationSeconds * 1000);

  const params = new URLSearchParams();
  params.set("appId", config.appId);
  params.set("signa", signa);
  params.set("ts", ts);
  params.set("fileName", fileName);
  params.set("fileSize", fileSize.toString());
  params.set("duration", durationMs.toString());
  params.set("language", config.language);
  params.set("audioMode", "fileStream");

  const isStandardWav =
    audioInfo.codec === "pcm_s16le" &&
    audioInfo.sampleRate === "16000" &&
    (audioInfo.channels === "1" || audioInfo.channels === "unknown");

  if (isStandardWav) {
    params.set("standardWav", "1");
  }

  const url = `${XFYUN_UPLOAD_URL}?${params.toString()}`;

  xfyunDebugLog(
    `[xfyun upload] uploadFileName=${fileName} uploadFileSize=${fileSize} uploadDurationMs=${durationMs} ffprobeDurationSeconds=${audioInfo.durationSeconds} sampleRate=${audioInfo.sampleRate} channels=${audioInfo.channels} codec=${audioInfo.codec} standardWav=${isStandardWav ? "1" : "not set"} language=${config.language} audioMode=fileStream`,
  );

  const response = await fetchWithFileBody(url, {
    filePath,
    headers: {
      "Content-Type": "application/octet-stream",
      "Content-Length": String(fileSize),
    },
    signal,
  });

  const body = (await response.json()) as {
    code: string;
    descInfo: string;
    content?: {
      orderId: string;
      taskEstimateTime: number;
    };
  };

  await saveXfyunDebugJson(
    debugDir,
    "upload-response.json",
    JSON.stringify(body, null, 2),
  );

  xfyunDebugLog(
    `[xfyun upload response] httpStatus=${response.status}` +
      ` code=${body.code}` +
      ` descInfo=${body.descInfo}` +
      ` orderId=${body.content?.orderId ?? "?"}` +
      ` taskEstimateTime=${body.content?.taskEstimateTime ?? "?"}`,
  );

  if (!response.ok || body.code !== "000000") {
    throw new Error(
      `讯飞上传失败：${body.descInfo ?? `HTTP ${response.status}`}`,
    );
  }

  if (!body.content?.orderId) {
    throw new Error("讯飞上传失败：未返回订单 ID。");
  }

  return {
    orderId: body.content.orderId,
    uploadFileName: fileName,
    uploadFileSize: fileSize,
    uploadDurationMs: durationMs,
    debugDir,
  };
}

export async function getXfyunResultOnce(
  orderId: string,
  variant: XfyunResultVariant,
  config: XfyunConfig,
  debugDir: string,
  signal: AbortSignal,
): Promise<XfyunResultResponse> {
  const ts = Math.floor(Date.now() / 1000).toString();
  const signa = generateXfyunSigna(config.appId, ts, config.secretKey);

  const params = new URLSearchParams();
  params.set("appId", config.appId);
  params.set("signa", signa);
  params.set("ts", ts);
  params.set("orderId", orderId);
  if (variant.resultType) {
    params.set("resultType", variant.resultType);
  }

  const url = `${XFYUN_RESULT_URL}?${params.toString()}`;
  const init: RequestInit = { method: variant.method, signal };

  if (variant.method === "POST") {
    init.body = new FormData();
  }

  const response = await fetch(url, init);
  const rawText = await response.text();

  let body: XfyunResultBody;
  try {
    body = JSON.parse(rawText);
  } catch {
    throw new Error(
      `讯飞 getResult 返回非 JSON (${variant.name})。前 500 字符：${rawText.slice(0, 500)}`,
    );
  }

  await saveXfyunDebugJson(
    debugDir,
    `get-result-${variant.name}.json`,
    rawText,
  );

  const orderInfo = body.content?.orderInfo;
  const contentKeys = body.content ? Object.keys(body.content) : [];
  const orderResult = body.content?.orderResult;
  const orderResultType = typeof orderResult;
  const orderResultLen =
    orderResultType === "string" ? (orderResult as string).length : 0;
  const transResultType = typeof body.content?.transResult;
  const transResultLen =
    transResultType === "string"
      ? (body.content!.transResult as string).length
      : 0;
  const predictResultType = typeof body.content?.predictResult;
  const predictResultLen =
    predictResultType === "string"
      ? (body.content!.predictResult as string).length
      : 0;

  xfyunDebugLog(
    `[xfyun getResult] variant=${variant.name} method=${variant.method}` +
      ` hasResultType=${variant.resultType !== null}` +
      ` resultType=${variant.resultType ?? "(none)"}` +
      ` code=${body.code}` +
      ` descInfo=${body.descInfo}` +
      ` status=${orderInfo?.status ?? "?"}` +
      ` failType=${orderInfo?.failType ?? "?"}` +
      ` originalDuration=${orderInfo?.originalDuration ?? "?"}` +
      ` realDuration=${orderInfo?.realDuration ?? "?"}` +
      ` taskEstimateTime=${body.content?.taskEstimateTime ?? "?"}` +
      ` contentKeys=[${contentKeys.join(",")}]` +
      ` orderResultType=${orderResultType} orderResultLen=${orderResultLen}` +
      ` transResultType=${transResultType} transResultLen=${transResultLen}` +
      ` predictResultType=${predictResultType} predictResultLen=${predictResultLen}`,
  );

  return { body, variantName: variant.name };
}
