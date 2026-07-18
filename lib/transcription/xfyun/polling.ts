import { TranscribeBusinessError } from "@/lib/transcribe-error";
import { formatTranscriptErrorMessage } from "@/lib/transcript-error-message";
import { abortableTranscriptionDelay } from "@/lib/transcription-abort.mjs";
import { getXfyunResultOnce } from "./client";
import { xfyunDebugLog } from "./debug";
import {
  classifyXfyunPollResponse,
  extractTextFromXfyunResult,
  formatXfyunPollSnapshot,
  formatXfyunVariantSummary,
  hasXfyunOrderResult,
  makeXfyunDebugInfo,
  XFYUN_RESULT_VARIANTS,
} from "./protocol";
import type {
  XfyunConfig,
  XfyunDebugInfo,
  XfyunOrderInfo,
  XfyunUploadInfo,
} from "./types";

const MAX_POLL_COUNT = 60;
const POLL_INTERVAL_MS = 5_000;
const MAX_POLL_DURATION_MS = 10 * 60 * 1_000;
const STATUS4_EMPTY_RETRY_COUNT = 6;
const STATUS4_EMPTY_RETRY_INTERVAL_MS = 5_000;

export type XfyunPollingDependencies = Readonly<{
  getResultOnce: typeof getXfyunResultOnce;
  delay: typeof abortableTranscriptionDelay;
  now: () => number;
}>;

const DEFAULT_POLLING_DEPENDENCIES: XfyunPollingDependencies = {
  getResultOnce: getXfyunResultOnce,
  delay: abortableTranscriptionDelay,
  now: Date.now,
};

function buildXfyunUploadError(
  prefix: string,
  uploadInfo: XfyunUploadInfo,
  orderInfo: XfyunOrderInfo,
  variantSummaries?: string[],
  debugInfo?: XfyunDebugInfo,
) {
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

export async function pollXfyunResult(
  orderId: string,
  config: XfyunConfig,
  uploadInfo: XfyunUploadInfo,
  debugDir: string,
  debugAudioPath: string | null,
  signal: AbortSignal,
  dependencies: XfyunPollingDependencies = DEFAULT_POLLING_DEPENDENCIES,
): Promise<string> {
  const startTime = dependencies.now();
  let status4EmptyCount = 0;

  for (let attempt = 0; attempt < MAX_POLL_COUNT; attempt++) {
    const pollAttempt = attempt + 1;
    const primaryResult = await dependencies.getResultOnce(
      orderId,
      XFYUN_RESULT_VARIANTS[0],
      config,
      debugDir,
      signal,
    );

    const primaryBody = primaryResult.body;
    const elapsedMs = dependencies.now() - startTime;
    const decision = classifyXfyunPollResponse(primaryBody);

    xfyunDebugLog(
      formatXfyunPollSnapshot(pollAttempt, elapsedMs, primaryResult),
    );

    if (decision.kind === "query_error") {
      xfyunDebugLog(
        `[xfyun poll #${pollAttempt}] getResult returned non-success code=${primaryBody.code} descInfo=${primaryBody.descInfo}`,
      );
      throw new Error(
        `讯飞查询结果失败：${primaryBody.descInfo ?? `code=${primaryBody.code}`}`,
      );
    }

    if (decision.kind === "missing_order_info") {
      xfyunDebugLog(
        `[xfyun poll #${pollAttempt}] missing orderInfo contentKeys=[${primaryBody.content ? Object.keys(primaryBody.content).join(",") : ""}]`,
      );
      throw new Error("讯飞查询结果失败：未返回订单信息。");
    }

    if (decision.kind === "failed") {
      const failType = decision.orderInfo.failType;
      xfyunDebugLog(
        `[xfyun poll #${pollAttempt}] order failed status=-1 failType=${failType} descInfo=${primaryBody.descInfo ?? "?"}`,
      );
      const rawMsg = `讯飞转写失败：订单 ${orderId} 处理失败 (failType=${failType} descInfo=${primaryBody.descInfo ?? "无详情"})。`;
      const userMsg = formatTranscriptErrorMessage(rawMsg);
      throw new TranscribeBusinessError(userMsg, rawMsg);
    }

    if (decision.kind === "processing") {
      xfyunDebugLog(
        `[xfyun poll #${pollAttempt}] 订单处理中 (status=${decision.orderInfo.status})，等待 ${POLL_INTERVAL_MS / 1000}s 后重试。`,
      );

      if (dependencies.now() - startTime > MAX_POLL_DURATION_MS) {
        throw new Error(
          buildXfyunUploadError(
            "讯飞转写超时",
            uploadInfo,
            decision.orderInfo,
            undefined,
            makeXfyunDebugInfo(orderId, primaryBody, debugDir, debugAudioPath),
          ),
        );
      }

      await dependencies.delay(POLL_INTERVAL_MS, signal);
      continue;
    }

    if (decision.kind === "completed") {
      if (decision.hasOrderResult) {
        xfyunDebugLog(
          `[xfyun poll #${pollAttempt}] completed with primary orderResult status=4 orderResultLen=${typeof decision.orderResult === "string" ? decision.orderResult.length : "object"}`,
        );
        return extractTextFromXfyunResult(decision.orderResult);
      }

      const variantSummaries = [formatXfyunVariantSummary(primaryResult)];
      let foundResult: string | null = null;

      for (
        let variantIndex = 1;
        variantIndex < XFYUN_RESULT_VARIANTS.length;
        variantIndex++
      ) {
        const fallback = await dependencies.getResultOnce(
          orderId,
          XFYUN_RESULT_VARIANTS[variantIndex],
          config,
          debugDir,
          signal,
        );

        variantSummaries.push(formatXfyunVariantSummary(fallback));
        xfyunDebugLog(
          `[xfyun poll #${pollAttempt}] fallback variant summary ${formatXfyunVariantSummary(fallback)}`,
        );

        const fallbackResult = fallback.body.content?.orderResult;
        if (hasXfyunOrderResult(fallbackResult)) {
          xfyunDebugLog(
            `[xfyun fallback] 变体 ${XFYUN_RESULT_VARIANTS[variantIndex].name} 拿到 orderResult，解析中。`,
          );

          foundResult = extractTextFromXfyunResult(fallbackResult);
          break;
        }
      }

      if (foundResult !== null) {
        return foundResult;
      }

      status4EmptyCount++;

      if (status4EmptyCount > STATUS4_EMPTY_RETRY_COUNT) {
        xfyunDebugLog(
          `[xfyun poll #${pollAttempt}] status=4 orderResult empty final failure status4EmptyCount=${status4EmptyCount} variantSummaries=${variantSummaries.join(" | ")}`,
        );
        throw new Error(
          buildXfyunUploadError(
            `讯飞订单已完成但所有变体 orderResult 均为空（已重试 ${status4EmptyCount} 次）。`,
            uploadInfo,
            decision.orderInfo,
            variantSummaries,
            makeXfyunDebugInfo(orderId, primaryBody, debugDir, debugAudioPath),
          ),
        );
      }

      xfyunDebugLog(
        `[xfyun poll #${pollAttempt}] status=4 但 orderResult 为空（第 ${status4EmptyCount} 次），等待 ${STATUS4_EMPTY_RETRY_INTERVAL_MS / 1000}s 后重试。variantSummaries=${variantSummaries.join(" | ")}`,
      );

      if (dependencies.now() - startTime > MAX_POLL_DURATION_MS) {
        throw new Error(
          buildXfyunUploadError(
            "讯飞转写超时（status=4 但 orderResult 始终为空）",
            uploadInfo,
            decision.orderInfo,
            variantSummaries,
            makeXfyunDebugInfo(orderId, primaryBody, debugDir, debugAudioPath),
          ),
        );
      }

      await dependencies.delay(STATUS4_EMPTY_RETRY_INTERVAL_MS, signal);
      continue;
    }

    xfyunDebugLog(
      `[xfyun poll #${pollAttempt}] 未知状态 status=${decision.orderInfo.status}，等待 ${POLL_INTERVAL_MS / 1000}s 后重试。`,
    );

    if (dependencies.now() - startTime > MAX_POLL_DURATION_MS) {
      throw new Error(
        buildXfyunUploadError(
          "讯飞转写超时",
          uploadInfo,
          decision.orderInfo,
          undefined,
          makeXfyunDebugInfo(orderId, primaryBody, debugDir, debugAudioPath),
        ),
      );
    }

    await dependencies.delay(POLL_INTERVAL_MS, signal);
  }

  xfyunDebugLog(
    `[xfyun poll] timeout after max poll count orderId=${orderId} maxPollCount=${MAX_POLL_COUNT} elapsedMs=${dependencies.now() - startTime}`,
  );

  throw new Error(
    `讯飞转写超时：订单 ${orderId} 轮询 ${MAX_POLL_COUNT} 次后仍未完成。`,
  );
}
