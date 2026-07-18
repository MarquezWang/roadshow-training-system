import { createHash, createHmac } from "crypto";
import type { XfyunConfig } from "./types";

export const XFYUN_UPLOAD_URL = "https://raasr.xfyun.cn/v2/api/upload";
export const XFYUN_RESULT_URL = "https://raasr.xfyun.cn/v2/api/getResult";

export function getXfyunConfig(): XfyunConfig {
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

export function generateXfyunSigna(
  appId: string,
  ts: string,
  secretKey: string,
) {
  const baseString = appId + ts;
  const md5 = createHash("md5").update(baseString, "utf8").digest("hex");
  const hmac = createHmac("sha1", secretKey).update(md5, "utf8").digest();

  return hmac.toString("base64");
}
