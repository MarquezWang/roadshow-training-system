import { createHash, createHmac } from "crypto";
import { existsSync } from "fs";
import { readFile, unlink, mkdir, writeFile } from "fs/promises";
import { tmpdir } from "os";
import path from "path";
import { execFile } from "child_process";
import { promisify } from "util";
import { TranscribeBusinessError } from "@/lib/transcribe-error";
import { formatTranscriptErrorMessage } from "@/lib/transcript-error-message";
import {
  abortableTranscriptionDelay,
  throwIfTranscriptionAborted,
} from "@/lib/transcription-abort.mjs";

const execFileAsync = promisify(execFile);

const XFYUN_UPLOAD_URL = "https://raasr.xfyun.cn/v2/api/upload";
const XFYUN_RESULT_URL = "https://raasr.xfyun.cn/v2/api/getResult";

const MAX_POLL_COUNT = 60;
const POLL_INTERVAL_MS = 5_000;
const MAX_POLL_DURATION_MS = 10 * 60 * 1_000;
const STATUS4_EMPTY_RETRY_COUNT = 6;
const STATUS4_EMPTY_RETRY_INTERVAL_MS = 5_000;

const XFYUN_DEBUG_DIR = path.join(
  /* turbopackIgnore: true */ process.cwd(),
  "tmp",
  "xfyun-debug",
);
const XFYUN_DEBUG = process.env.XFYUN_DEBUG === "true";
const KEEP_TEMP_AUDIO = process.env.XFYUN_KEEP_TEMP_AUDIO === "true";

function debugLog(...args: unknown[]) {
  if (XFYUN_DEBUG) console.log(...args);
}

const formatToExt: Record<string, string> = {
  "audio/webm": "webm",
  "audio/mp4": "m4a",
  "audio/mpeg": "mp3",
  "audio/wav": "wav",
  "audio/x-wav": "wav",
};

const extNeedsConversion: Record<string, boolean> = {
  webm: true,
};

type AudioInfo = {
  durationSeconds: number;
  codec: string;
  sampleRate: string;
  channels: string;
};

function getXfyunConfig() {
  const appId = (process.env.XFYUN_APP_ID ?? "").trim();
  const secretKey = (process.env.XFYUN_SECRET_KEY ?? "").trim();
  const language = (process.env.XFYUN_LANGUAGE ?? "cn").trim();

  if (!appId) {
    throw new Error("未配置讯飞 App ID，请配置 XFYUN_APP_ID");
  }

  if (!secretKey) {
    throw new Error("未配置讯飞 Secret Key，请配置 XFYUN_SECRET_KEY");
  }

  return { appId, secretKey, language };
}

function generateSigna(appId: string, ts: string, secretKey: string) {
  const baseString = appId + ts;
  const md5 = createHash("md5").update(baseString, "utf8").digest("hex");
  const hmac = createHmac("sha1", secretKey).update(md5, "utf8").digest();

  return hmac.toString("base64");
}

function normalizeMimeType(mimeType: string) {
  return mimeType.split(";")[0]?.trim().toLowerCase() ?? "";
}

function getFileExtension(filePath: string, mimeType?: string | null) {
  const ext = path.extname(filePath).toLowerCase().replace(".", "");

  if (ext) {
    return ext;
  }

  if (mimeType) {
    return formatToExt[normalizeMimeType(mimeType)] ?? "wav";
  }

  return "wav";
}

async function needsConversion(
  filePath: string,
  mimeType?: string | null,
): Promise<boolean> {
  const ext = getFileExtension(filePath, mimeType);

  return extNeedsConversion[ext] === true;
}

async function saveDebugJson(
  debugDir: string,
  filename: string,
  rawJson: string,
): Promise<void> {
  if (!XFYUN_DEBUG) return;
  try {
    await mkdir(debugDir, { recursive: true });
    await writeFile(path.join(debugDir, filename), rawJson, "utf-8");
    debugLog(`[xfyun debug] saved: ${filename}`);
  } catch {
    debugLog(`[xfyun debug] 无法保存调试文件：${filename}`);
  }
}

async function probeAudio(
  filePath: string,
  signal: AbortSignal,
): Promise<AudioInfo> {
  const probe = await execFileAsync(
    "ffprobe",
    [
      "-v",
      "quiet",
      "-print_format",
      "json",
      "-show_format",
      "-show_streams",
      filePath,
    ],
    { signal, timeout: 30_000 },
  );

  const info = JSON.parse(probe.stdout) as {
    format?: { duration?: string };
    streams?: Array<{
      codec_type?: string;
      codec_name?: string;
      sample_rate?: string;
      channels?: number;
    }>;
  };

  const audioStream = info.streams?.find(
    (s) => s.codec_type === "audio",
  );

  const audioInfo: AudioInfo = {
    durationSeconds: Number(info.format?.duration ?? "0"),
    codec: audioStream?.codec_name ?? "unknown",
    sampleRate: audioStream?.sample_rate ?? "unknown",
    channels: String(audioStream?.channels ?? "unknown"),
  };

  debugLog(
    `[xfyun probe] duration=${audioInfo.durationSeconds}s codec=${audioInfo.codec} sampleRate=${audioInfo.sampleRate} channels=${audioInfo.channels}`,
  );

  return audioInfo;
}

async function convertToWav(
  inputPath: string,
  signal: AbortSignal,
): Promise<{ outputPath: string; audioInfo: AudioInfo }> {
  const outputPath = path.join(
    tmpdir(),
    `xfyun-convert-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.wav`,
  );

  try {
    await execFileAsync(
      "ffmpeg",
      [
        "-y",
        "-i",
        inputPath,
        "-acodec",
        "pcm_s16le",
        "-ar",
        "16000",
        "-ac",
        "1",
        "-sample_fmt",
        "s16",
        outputPath,
      ],
      { signal, timeout: 120_000 },
    );
  } catch (error) {
    if (
      error instanceof Error &&
      "code" in error &&
      (error as NodeJS.ErrnoException).code === "ENOENT"
    ) {
      throw new Error(
        "当前录音为 WebM 格式，讯飞不支持该格式，需要 ffmpeg 转码。请安装 ffmpeg 后重试。（https://ffmpeg.org/download.html）",
      );
    }

    throw new Error(
      `音频转码失败：${error instanceof Error ? error.message : "未知错误"}`,
    );
  }

  if (!existsSync(/* turbopackIgnore: true */ outputPath)) {
    throw new Error("音频转码失败：ffmpeg 未生成输出文件。");
  }

  const stat = await readFile(/* turbopackIgnore: true */ outputPath, {
    signal,
  }).then((buf) => buf.length);
  debugLog(
    `[xfyun convert] outputPath=${outputPath} fileSize=${stat} bytes`,
  );

  const audioInfo = await probeAudio(outputPath, signal);

  return { outputPath, audioInfo };
}

async function uploadAudio(
  filePath: string,
  config: ReturnType<typeof getXfyunConfig>,
  audioInfo: AudioInfo,
  debugDir: string,
  signal: AbortSignal,
): Promise<{ orderId: string; uploadFileName: string; uploadFileSize: number; uploadDurationMs: number; debugDir: string }> {
  const ts = Math.floor(Date.now() / 1000).toString();
  const signa = generateSigna(config.appId, ts, config.secretKey);
  const fileName = path.basename(filePath);
  throwIfTranscriptionAborted(signal);
  const fileBuffer = await readFile(/* turbopackIgnore: true */ filePath, {
    signal,
  });
  const fileSize = fileBuffer.length;
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

  // 标准 wav（16k 16bit 单声道）时传 standardWav=1
  const isStandardWav =
    audioInfo.codec === "pcm_s16le" &&
    audioInfo.sampleRate === "16000" &&
    (audioInfo.channels === "1" || audioInfo.channels === "unknown");

  if (isStandardWav) {
    params.set("standardWav", "1");
  }

  const url = `${XFYUN_UPLOAD_URL}?${params.toString()}`;

  debugLog(
    `[xfyun upload] uploadFileName=${fileName} uploadFileSize=${fileSize} uploadDurationMs=${durationMs} ffprobeDurationSeconds=${audioInfo.durationSeconds} sampleRate=${audioInfo.sampleRate} channels=${audioInfo.channels} codec=${audioInfo.codec} standardWav=${isStandardWav ? "1" : "not set"} language=${config.language} audioMode=fileStream`,
  );

  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/octet-stream",
    },
    body: new Uint8Array(fileBuffer),
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

  // 保存 debug 文件
  const uploadResponseJson = JSON.stringify(body, null, 2);
  await saveDebugJson(debugDir, "upload-response.json", uploadResponseJson);

  debugLog(
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

// ---- getResult 响应结构 ----

type XfyunResultBody = {
  code: string;
  descInfo: string;
  content?: {
    taskEstimateTime?: number;
    transResult?: unknown;
    predictResult?: unknown;
    orderResult?: unknown;
    orderInfo?: {
      orderId: string;
      failType: number;
      status: number;
      originalDuration?: number;
      realDuration?: number;
    };
  };
};

// ---- getResult 变体定义 ----

type ResultVariant = {
  name: string;
  method: "GET" | "POST";
  resultType: string | null; // null 表示不传 resultType
};

const RESULT_VARIANTS: ResultVariant[] = [
  { name: "GET_DEFAULT", method: "GET", resultType: null },
  { name: "GET_TRANSFER", method: "GET", resultType: "transfer" },
  { name: "POST_FORM_DEFAULT", method: "POST", resultType: null },
  {
    name: "POST_FORM_TRANSFER",
    method: "POST",
    resultType: "transfer",
  },
];

// ---- getResultOnce ----

async function getResultOnce(
  orderId: string,
  variant: ResultVariant,
  config: ReturnType<typeof getXfyunConfig>,
  debugDir: string,
  signal: AbortSignal,
): Promise<{ body: XfyunResultBody; variantName: string }> {
  const ts = Math.floor(Date.now() / 1000).toString();
  const signa = generateSigna(config.appId, ts, config.secretKey);

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

  // 保存 debug 文件
  const debugFilename = `get-result-${variant.name}.json`;
  await saveDebugJson(debugDir, debugFilename, rawText);

  // 打印脱敏摘要
  const orderInfo = body.content?.orderInfo;
  const contentKeys = body.content ? Object.keys(body.content) : [];

  const orderResult = body.content?.orderResult;
  const orderResultType = typeof orderResult;
  const orderResultLen =
    orderResultType === "string"
      ? (orderResult as string).length
      : 0;

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

  debugLog(
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

function formatVariantSummary(result: {
  body: XfyunResultBody;
  variantName: string;
}) {
  const orderInfo = result.body.content?.orderInfo;

  return (
    `[${result.variantName}]` +
    ` code=${result.body.code}` +
    ` descInfo=${result.body.descInfo}` +
    ` status=${orderInfo?.status ?? "?"}` +
    ` failType=${orderInfo?.failType ?? "?"}` +
    ` hasOrderResult=${result.body.content?.orderResult !== undefined && result.body.content?.orderResult !== null && result.body.content?.orderResult !== ""}` +
    ` realDuration=${orderInfo?.realDuration ?? "?"}`
  );
}

function formatPollSnapshot(
  attempt: number,
  elapsedMs: number,
  result: {
    body: XfyunResultBody;
    variantName: string;
  },
) {
  const orderInfo = result.body.content?.orderInfo;
  const contentKeys = result.body.content ? Object.keys(result.body.content) : [];
  const orderResult = result.body.content?.orderResult;
  const hasOrderResult =
    orderResult !== undefined && orderResult !== null && orderResult !== "";
  const orderResultLen =
    typeof orderResult === "string" ? orderResult.length : 0;

  return (
    `[xfyun poll #${attempt}]` +
    ` elapsedMs=${elapsedMs}` +
    ` variant=${result.variantName}` +
    ` code=${result.body.code}` +
    ` descInfo=${result.body.descInfo}` +
    ` status=${orderInfo?.status ?? "?"}` +
    ` failType=${orderInfo?.failType ?? "?"}` +
    ` originalDuration=${orderInfo?.originalDuration ?? "?"}` +
    ` realDuration=${orderInfo?.realDuration ?? "?"}` +
    ` taskEstimateTime=${result.body.content?.taskEstimateTime ?? "?"}` +
    ` contentKeys=[${contentKeys.join(",")}]` +
    ` hasOrderResult=${hasOrderResult}` +
    ` orderResultType=${typeof orderResult}` +
    ` orderResultLen=${orderResultLen}`
  );
}

// ---- pollResult（含变体回退、status=4 空结果重试） ----

function makeDebugInfo(
  orderId: string,
  body: XfyunResultBody,
  debugDir: string,
  debugAudioPath: string | null,
) {
  const contentKeys = body.content ? Object.keys(body.content) : [];
  const orderResult = body.content?.orderResult;
  const orderResultType = typeof orderResult;

  let orderResultValue = "(none)";
  if (orderResult !== undefined && orderResult !== null) {
    if (orderResultType === "string") {
      orderResultValue =
        (orderResult as string).slice(0, 200) +
        ((orderResult as string).length > 200 ? "..." : "");
    } else {
      orderResultValue = JSON.stringify(orderResult).slice(0, 200);
    }
  }

  return {
    orderId,
    debugDir,
    debugAudioPath,
    contentKeys,
    orderResultType,
    orderResultValue,
    taskEstimateTime: String(body.content?.taskEstimateTime ?? "?"),
    descInfo: body.descInfo ?? "?",
  };
}

async function pollResult(
  orderId: string,
  config: ReturnType<typeof getXfyunConfig>,
  uploadInfo: {
    uploadFileName: string;
    uploadFileSize: number;
    uploadDurationMs: number;
    audioInfo: AudioInfo;
  },
  debugDir: string,
  debugAudioPath: string | null,
  signal: AbortSignal,
): Promise<string> {
  const startTime = Date.now();
  let status4EmptyCount = 0;

  for (let attempt = 0; attempt < MAX_POLL_COUNT; attempt++) {
    const pollAttempt = attempt + 1;
    // 优先使用变体 A：GET / 不传 resultType
    const primaryResult = await getResultOnce(
      orderId,
      RESULT_VARIANTS[0],
      config,
      debugDir,
      signal,
    );

    const primaryBody = primaryResult.body;
    const elapsedMs = Date.now() - startTime;

    debugLog(formatPollSnapshot(pollAttempt, elapsedMs, primaryResult));

    if (!primaryBody.code || primaryBody.code !== "000000") {
      debugLog(
        `[xfyun poll #${pollAttempt}] getResult returned non-success code=${primaryBody.code} descInfo=${primaryBody.descInfo}`,
      );
      throw new Error(
        `讯飞查询结果失败：${primaryBody.descInfo ?? `code=${primaryBody.code}`}`,
      );
    }

    const orderInfo = primaryBody.content?.orderInfo;

    if (!orderInfo) {
      debugLog(
        `[xfyun poll #${pollAttempt}] missing orderInfo contentKeys=[${primaryBody.content ? Object.keys(primaryBody.content).join(",") : ""}]`,
      );
      throw new Error("讯飞查询结果失败：未返回订单信息。");
    }

    // status=-1：失败
    if (orderInfo.status === -1) {
      const failType = orderInfo.failType;
      debugLog(
        `[xfyun poll #${pollAttempt}] order failed status=-1 failType=${failType} descInfo=${primaryBody.descInfo ?? "?"}`,
      );
      const rawMsg = `讯飞转写失败：订单 ${orderId} 处理失败 (failType=${failType} descInfo=${primaryBody.descInfo ?? "无详情"})。`;
      const userMsg = formatTranscriptErrorMessage(rawMsg);
      throw new TranscribeBusinessError(userMsg, rawMsg);
    }

    // status=0 或 3：继续轮询
    if (orderInfo.status === 0 || orderInfo.status === 3) {
      debugLog(
        `[xfyun poll #${pollAttempt}] 订单处理中 (status=${orderInfo.status})，等待 ${POLL_INTERVAL_MS / 1000}s 后重试。`,
      );

      if (Date.now() - startTime > MAX_POLL_DURATION_MS) {
        throw new Error(
          buildUploadError(
            "讯飞转写超时",
            uploadInfo,
            orderInfo,
            undefined,
            makeDebugInfo(orderId, primaryBody, debugDir, debugAudioPath),
          ),
        );
      }

      await abortableTranscriptionDelay(POLL_INTERVAL_MS, signal);
      continue;
    }

    // status=4：订单完成，尝试各种变体获取 orderResult
    if (orderInfo.status === 4) {
      // 先用变体 A 的结果
      const aHasResult =
        primaryBody.content?.orderResult !== undefined &&
        primaryBody.content?.orderResult !== null &&
        primaryBody.content?.orderResult !== "";

      if (aHasResult) {
        debugLog(
          `[xfyun poll #${pollAttempt}] completed with primary orderResult status=4 orderResultLen=${typeof primaryBody.content!.orderResult === "string" ? primaryBody.content!.orderResult.length : "object"}`,
        );
        return extractTextFromResult(
          primaryBody.content!.orderResult,
        );
      }

      // 变体 A 为空，尝试 B / C / D
      const variantSummaries = [formatVariantSummary(primaryResult)];

      let foundResult: string | null = null;

      for (let vi = 1; vi < RESULT_VARIANTS.length; vi++) {
        const fallback = await getResultOnce(
          orderId,
          RESULT_VARIANTS[vi],
          config,
          debugDir,
          signal,
        );

        variantSummaries.push(formatVariantSummary(fallback));
        debugLog(
          `[xfyun poll #${pollAttempt}] fallback variant summary ${formatVariantSummary(fallback)}`,
        );

        const fContent = fallback.body.content;
        const hasResult =
          fContent?.orderResult !== undefined &&
          fContent?.orderResult !== null &&
          fContent?.orderResult !== "";

        if (hasResult) {
          debugLog(
            `[xfyun fallback] 变体 ${RESULT_VARIANTS[vi].name} 拿到 orderResult，解析中。`,
          );

          foundResult = extractTextFromResult(fContent!.orderResult);
          break;
        }
      }

      if (foundResult !== null) {
        return foundResult;
      }

      // 所有变体都为空，检查是否超过重试次数
      status4EmptyCount++;

      if (status4EmptyCount > STATUS4_EMPTY_RETRY_COUNT) {
        debugLog(
          `[xfyun poll #${pollAttempt}] status=4 orderResult empty final failure status4EmptyCount=${status4EmptyCount} variantSummaries=${variantSummaries.join(" | ")}`,
        );
        throw new Error(
          buildUploadError(
            `讯飞订单已完成但所有变体 orderResult 均为空（已重试 ${status4EmptyCount} 次）。`,
            uploadInfo,
            orderInfo,
            variantSummaries,
            makeDebugInfo(orderId, primaryBody, debugDir, debugAudioPath),
          ),
        );
      }

      debugLog(
        `[xfyun poll #${pollAttempt}] status=4 但 orderResult 为空（第 ${status4EmptyCount} 次），等待 ${STATUS4_EMPTY_RETRY_INTERVAL_MS / 1000}s 后重试。variantSummaries=${variantSummaries.join(" | ")}`,
      );

      if (Date.now() - startTime > MAX_POLL_DURATION_MS) {
        throw new Error(
          buildUploadError(
            "讯飞转写超时（status=4 但 orderResult 始终为空）",
            uploadInfo,
            orderInfo,
            variantSummaries,
            makeDebugInfo(orderId, primaryBody, debugDir, debugAudioPath),
          ),
        );
      }

      await abortableTranscriptionDelay(
        STATUS4_EMPTY_RETRY_INTERVAL_MS,
        signal,
      );
      continue;
    }

    debugLog(
      `[xfyun poll #${pollAttempt}] 未知状态 status=${orderInfo.status}，等待 ${POLL_INTERVAL_MS / 1000}s 后重试。`,
    );

    if (Date.now() - startTime > MAX_POLL_DURATION_MS) {
      throw new Error(
        buildUploadError(
          "讯飞转写超时",
          uploadInfo,
          orderInfo,
          undefined,
          makeDebugInfo(orderId, primaryBody, debugDir, debugAudioPath),
        ),
      );
    }

    await abortableTranscriptionDelay(POLL_INTERVAL_MS, signal);
  }

  debugLog(
    `[xfyun poll] timeout after max poll count orderId=${orderId} maxPollCount=${MAX_POLL_COUNT} elapsedMs=${Date.now() - startTime}`,
  );

  throw new Error(
    `讯飞转写超时：订单 ${orderId} 轮询 ${MAX_POLL_COUNT} 次后仍未完成。`,
  );
}

function buildUploadError(
  prefix: string,
  uploadInfo: {
    uploadFileName: string;
    uploadFileSize: number;
    uploadDurationMs: number;
    audioInfo: AudioInfo;
  },
  orderInfo: {
    failType: number;
    status: number;
    originalDuration?: number;
    realDuration?: number;
  },
  variantSummaries?: string[],
  debugInfo?: {
    orderId: string;
    debugDir: string;
    debugAudioPath: string | null;
    contentKeys: string[];
    orderResultType: string;
    orderResultValue: string;
    taskEstimateTime: string;
    descInfo: string;
  },
): string {
  const parts = [
    prefix,
    `uploadFileName=${uploadInfo.uploadFileName}`,
    `uploadFileSize=${uploadInfo.uploadFileSize}`,
    `uploadDurationMs=${uploadInfo.uploadDurationMs}`,
    `ffprobeDurationSeconds=${uploadInfo.audioInfo.durationSeconds}`,
    `sampleRate=${uploadInfo.audioInfo.sampleRate}`,
    `channels=${uploadInfo.audioInfo.channels}`,
    `codec=${uploadInfo.audioInfo.codec}`,
    `originalDuration=${orderInfo.originalDuration ?? "?"}`,
    `realDuration=${orderInfo.realDuration ?? "?"}`,
    `status=${orderInfo.status}`,
    `failType=${orderInfo.failType}`,
  ];

  if (debugInfo) {
    parts.push(
      `orderId=${debugInfo.orderId}`,
      `debugDir=${debugInfo.debugDir}`,
      `debugAudioPath=${debugInfo.debugAudioPath ?? "(none)"}`,
      `contentKeys=[${debugInfo.contentKeys.join(",")}]`,
      `orderResultType=${debugInfo.orderResultType}`,
      `orderResultValue=${debugInfo.orderResultValue}`,
      `taskEstimateTime=${debugInfo.taskEstimateTime}`,
      `descInfo=${debugInfo.descInfo}`,
    );
  }

  if (variantSummaries && variantSummaries.length > 0) {
    parts.push(`variantSummaries: ${variantSummaries.join(" | ")}`);
  }

  return parts.join("。");
}

function extractTextFromResult(orderResult: unknown): string {
  if (orderResult === undefined || orderResult === null || orderResult === "") {
    throw new Error("讯飞订单已完成，但 orderResult 为空。");
  }

  let resultObj: {
    lattice?: Array<{
      json_1best?: unknown;
    }>;
    lattice2?: Array<{
      json_1best?: unknown;
    }>;
  };

  try {
    if (typeof orderResult === "string") {
      resultObj = JSON.parse(orderResult);
    } else if (typeof orderResult === "object") {
      resultObj = orderResult as typeof resultObj;
    } else {
      throw new Error("orderResult 不是有效的字符串或对象");
    }
  } catch (error) {
    if (error instanceof Error && error.message !== "orderResult 不是有效的字符串或对象") {
      throw new Error(`解析 orderResult JSON 失败：${error.message}`);
    }

    throw error;
  }

  try {
    // 优先 lattice2，回退到 lattice
    const lattice = resultObj.lattice2 ?? resultObj.lattice;
    const sentences: string[] = [];

    if (lattice) {
      for (const seg of lattice) {
        if (seg.json_1best) {
          let best: {
            st?: {
              rt?: Array<{
                ws?: Array<{
                  cw?: Array<{
                    w?: string;
                    wp?: string;
                  }>;
                }>;
              }>;
            };
          };

          if (typeof seg.json_1best === "string") {
            best = JSON.parse(seg.json_1best);
          } else {
            best = seg.json_1best as typeof best;
          }

          if (best.st?.rt) {
            for (const rtItem of best.st.rt) {
              if (rtItem.ws) {
                for (const wsItem of rtItem.ws) {
                  if (wsItem.cw) {
                    for (const cwItem of wsItem.cw) {
                      // 跳过 wp="g" 的分段标记
                      if (cwItem.wp === "g") continue;
                      if (cwItem.w) {
                        sentences.push(cwItem.w);
                      }
                    }
                  }
                }
              }
            }
          }
        }
      }
    }

    const text = sentences.join("");

    if (!text.trim()) {
      throw new TranscribeBusinessError(
        "转写结果为空，可能是静音、声音过小或录音时间过短。",
        "转写结果为空。",
      );
    }

    return text;
  } catch (error) {
    if (error instanceof TranscribeBusinessError || (error instanceof Error && error.message === "转写结果为空。")) {
      throw error;
    }

    throw new Error(
      `解析讯飞转写结果失败：${error instanceof Error ? error.message : "未知错误"}`,
    );
  }
}

export async function transcribeWithXfyun(
  filePath: string,
  mimeType?: string | null,
  signal: AbortSignal = new AbortController().signal,
): Promise<string> {
  const config = getXfyunConfig();
  const absolutePath = path.resolve(filePath);

  if (!existsSync(absolutePath)) {
    throw new Error(`音频文件不存在：${absolutePath}`);
  }

  let audioPath = absolutePath;
  let tempConvertedPath: string | null = null;
  let debugAudioPath: string | null = null;

  try {
    throwIfTranscriptionAborted(signal);
    let audioInfo: AudioInfo;

    if (await needsConversion(absolutePath, mimeType)) {
      const converted = await convertToWav(absolutePath, signal);
      tempConvertedPath = converted.outputPath;
      audioPath = converted.outputPath;
      audioInfo = converted.audioInfo;

      if (KEEP_TEMP_AUDIO) {
        debugAudioPath = converted.outputPath;
        debugLog(`[xfyun debug] 保留转码 wav: ${debugAudioPath}`);
      }
    } else {
      audioInfo = await probeAudio(absolutePath, signal);
      if (KEEP_TEMP_AUDIO) {
        debugAudioPath = absolutePath;
        debugLog(`[xfyun debug] 原始音频路径: ${debugAudioPath}`);
      }
    }

    const uploadResult = await uploadAudio(
      audioPath,
      config,
      audioInfo,
      XFYUN_DEBUG_DIR,
      signal,
    );

    const text = await pollResult(
      uploadResult.orderId,
      config,
      {
        uploadFileName: uploadResult.uploadFileName,
        uploadFileSize: uploadResult.uploadFileSize,
        uploadDurationMs: uploadResult.uploadDurationMs,
        audioInfo,
      },
      uploadResult.debugDir,
      debugAudioPath,
      signal,
    );

    // 保存 debug-summary.json（成功路径）
    const summary = {
      orderId: uploadResult.orderId,
      uploadFileName: uploadResult.uploadFileName,
      uploadFileSize: uploadResult.uploadFileSize,
      uploadDurationMs: uploadResult.uploadDurationMs,
      ffprobeDurationSeconds: audioInfo.durationSeconds,
      sampleRate: audioInfo.sampleRate,
      channels: audioInfo.channels,
      codec: audioInfo.codec,
      debugAudioPath,
      status: "completed",
    };
    await saveDebugJson(
      XFYUN_DEBUG_DIR,
      "debug-summary.json",
      JSON.stringify(summary, null, 2),
    );

    return text;
  } catch (error) {
    // 失败路径也保存 debug-summary
    const summary = {
      orderId: "unknown",
      debugAudioPath,
      status: "failed",
      error: error instanceof Error ? error.message : "未知错误",
    };
    await saveDebugJson(
      XFYUN_DEBUG_DIR,
      "debug-summary.json",
      JSON.stringify(summary, null, 2),
    ).catch(() => {});

    throw error;
  } finally {
    if (tempConvertedPath && !KEEP_TEMP_AUDIO) {
      try {
        await unlink(tempConvertedPath);
      } catch {
        // 清理临时文件失败不影响主流程
      }
    }
  }
}
