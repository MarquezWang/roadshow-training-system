import { TranscribeBusinessError } from "@/lib/transcribe-error";
import type {
  XfyunDebugInfo,
  XfyunOrderInfo,
  XfyunResultBody,
  XfyunResultResponse,
  XfyunResultVariant,
} from "./types";

export const XFYUN_RESULT_VARIANTS: XfyunResultVariant[] = [
  { name: "GET_DEFAULT", method: "GET", resultType: null },
  { name: "GET_TRANSFER", method: "GET", resultType: "transfer" },
  { name: "POST_FORM_DEFAULT", method: "POST", resultType: null },
  {
    name: "POST_FORM_TRANSFER",
    method: "POST",
    resultType: "transfer",
  },
];

export type XfyunPollDecision =
  | Readonly<{
      kind: "query_error";
    }>
  | Readonly<{
      kind: "missing_order_info";
    }>
  | Readonly<{
      kind: "failed";
      orderInfo: XfyunOrderInfo;
    }>
  | Readonly<{
      kind: "processing";
      orderInfo: XfyunOrderInfo;
    }>
  | Readonly<{
      kind: "completed";
      orderInfo: XfyunOrderInfo;
      orderResult: unknown;
      hasOrderResult: boolean;
    }>
  | Readonly<{
      kind: "unknown";
      orderInfo: XfyunOrderInfo;
    }>;

export function hasXfyunOrderResult(value: unknown) {
  return value !== undefined && value !== null && value !== "";
}

export function classifyXfyunPollResponse(
  body: XfyunResultBody,
): XfyunPollDecision {
  if (!body.code || body.code !== "000000") {
    return { kind: "query_error" };
  }

  const orderInfo = body.content?.orderInfo;
  if (!orderInfo) {
    return { kind: "missing_order_info" };
  }

  if (orderInfo.status === -1) {
    return { kind: "failed", orderInfo };
  }

  if (orderInfo.status === 0 || orderInfo.status === 3) {
    return { kind: "processing", orderInfo };
  }

  if (orderInfo.status === 4) {
    const orderResult = body.content?.orderResult;
    return {
      kind: "completed",
      orderInfo,
      orderResult,
      hasOrderResult: hasXfyunOrderResult(orderResult),
    };
  }

  return { kind: "unknown", orderInfo };
}

export function formatXfyunVariantSummary(result: XfyunResultResponse) {
  const orderInfo = result.body.content?.orderInfo;

  return (
    `[${result.variantName}]` +
    ` code=${result.body.code}` +
    ` descInfo=${result.body.descInfo}` +
    ` status=${orderInfo?.status ?? "?"}` +
    ` failType=${orderInfo?.failType ?? "?"}` +
    ` hasOrderResult=${hasXfyunOrderResult(result.body.content?.orderResult)}` +
    ` realDuration=${orderInfo?.realDuration ?? "?"}`
  );
}

export function formatXfyunPollSnapshot(
  attempt: number,
  elapsedMs: number,
  result: XfyunResultResponse,
) {
  const orderInfo = result.body.content?.orderInfo;
  const contentKeys = result.body.content
    ? Object.keys(result.body.content)
    : [];
  const orderResult = result.body.content?.orderResult;
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
    ` hasOrderResult=${hasXfyunOrderResult(orderResult)}` +
    ` orderResultType=${typeof orderResult}` +
    ` orderResultLen=${orderResultLen}`
  );
}

export function makeXfyunDebugInfo(
  orderId: string,
  body: XfyunResultBody,
  debugDir: string,
  debugAudioPath: string | null,
): XfyunDebugInfo {
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

export function extractTextFromXfyunResult(orderResult: unknown): string {
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
    if (
      error instanceof Error &&
      error.message !== "orderResult 不是有效的字符串或对象"
    ) {
      throw new Error(`解析 orderResult JSON 失败：${error.message}`);
    }

    throw error;
  }

  try {
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
    if (
      error instanceof TranscribeBusinessError ||
      (error instanceof Error && error.message === "转写结果为空。")
    ) {
      throw error;
    }

    throw new Error(
      `解析讯飞转写结果失败：${error instanceof Error ? error.message : "未知错误"}`,
    );
  }
}
