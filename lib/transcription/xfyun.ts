import { createHash, createHmac } from "crypto";
import { existsSync } from "fs";
import { readFile, unlink } from "fs/promises";
import { tmpdir } from "os";
import path from "path";
import { execFile } from "child_process";
import { promisify } from "util";

const execFileAsync = promisify(execFile);

const XFYUN_UPLOAD_URL = "https://raasr.xfyun.cn/v2/api/upload";
const XFYUN_RESULT_URL = "https://raasr.xfyun.cn/v2/api/getResult";

const MAX_POLL_COUNT = 60;
const POLL_INTERVAL_MS = 5_000;
const MAX_POLL_DURATION_MS = 10 * 60 * 1_000;

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

async function convertToWav(inputPath: string): Promise<string> {
  const outputPath = path.join(
    tmpdir(),
    `xfyun-convert-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.wav`,
  );

  try {
    await execFileAsync("ffmpeg", [
      "-y",
      "-i",
      inputPath,
      "-acodec",
      "pcm_s16le",
      "-ar",
      "16000",
      "-ac",
      "1",
      outputPath,
    ]);
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

  if (!existsSync(outputPath)) {
    throw new Error("音频转码失败：ffmpeg 未生成输出文件。");
  }

  return outputPath;
}

async function uploadAudio(
  filePath: string,
  config: ReturnType<typeof getXfyunConfig>,
): Promise<string> {
  const ts = Math.floor(Date.now() / 1000).toString();
  const signa = generateSigna(config.appId, ts, config.secretKey);
  const fileName = path.basename(filePath);
  const stat = await readFile(filePath).then(
    (buf) => buf.length,
    () => {
      throw new Error(`无法读取音频文件：${filePath}`);
    },
  );

  const params = new URLSearchParams();
  params.set("appId", config.appId);
  params.set("signa", signa);
  params.set("ts", ts);
  params.set("fileName", encodeURIComponent(fileName));
  params.set("fileSize", stat.toString());
  params.set("duration", "200");
  params.set("language", config.language);

  const url = `${XFYUN_UPLOAD_URL}?${params.toString()}`;
  const fileBuffer = await readFile(filePath);

  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/octet-stream",
      "Content-Length": fileBuffer.length.toString(),
    },
    body: fileBuffer,
  });

  const body = (await response.json()) as {
    code: string;
    descInfo: string;
    content?: {
      orderId: string;
      taskEstimateTime: number;
    };
  };

  if (!response.ok || body.code !== "000000") {
    throw new Error(
      `讯飞上传失败：${body.descInfo ?? `HTTP ${response.status}`}`,
    );
  }

  if (!body.content?.orderId) {
    throw new Error("讯飞上传失败：未返回订单 ID。");
  }

  return body.content.orderId;
}

async function pollResult(
  orderId: string,
  config: ReturnType<typeof getXfyunConfig>,
): Promise<string> {
  const startTime = Date.now();

  for (let attempt = 0; attempt < MAX_POLL_COUNT; attempt++) {
    const ts = Math.floor(Date.now() / 1000).toString();
    const signa = generateSigna(config.appId, ts, config.secretKey);

    const params = new URLSearchParams();
    params.set("appId", config.appId);
    params.set("signa", signa);
    params.set("ts", ts);
    params.set("orderId", orderId);

    const url = `${XFYUN_RESULT_URL}?${params.toString()}`;

    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "multipart/form-data",
      },
    });

    const body = (await response.json()) as {
      code: string;
      descInfo: string;
      content?: {
        orderInfo?: {
          orderId: string;
          failType: number;
          status: number;
          orderResult?: string;
        };
      };
    };

    if (!response.ok || body.code !== "000000") {
      throw new Error(
        `讯飞查询结果失败：${body.descInfo ?? `HTTP ${response.status}`}`,
      );
    }

    const orderInfo = body.content?.orderInfo;

    if (!orderInfo) {
      throw new Error("讯飞查询结果失败：未返回订单信息。");
    }

    // status: 1=uploaded, 2=merged, 3=processing, 4=completed, 5=failed
    if (orderInfo.status === 4) {
      return extractTextFromResult(orderInfo.orderResult ?? "");
    }

    if (orderInfo.status === 5) {
      throw new Error(
        `讯飞转写失败：订单 ${orderId} 处理失败 (failType=${orderInfo.failType})。`,
      );
    }

    if (Date.now() - startTime > MAX_POLL_DURATION_MS) {
      throw new Error(
        `讯飞转写超时：订单 ${orderId} 在 ${MAX_POLL_DURATION_MS / 1000} 秒内未返回结果。`,
      );
    }

    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
  }

  throw new Error(
    `讯飞转写超时：订单 ${orderId} 轮询 ${MAX_POLL_COUNT} 次后仍未完成。`,
  );
}

function extractTextFromResult(orderResult: string): string {
  try {
    const parsed = JSON.parse(orderResult) as {
      lattice?: Array<{
        json_1best?: string;
      }>;
    };

    const sentences: string[] = [];

    if (parsed.lattice) {
      for (const seg of parsed.lattice) {
        if (seg.json_1best) {
          const best = JSON.parse(seg.json_1best) as {
            st?: {
              rt?: Array<{
                ws?: Array<{
                  cw?: Array<{
                    w?: string;
                  }>;
                }>;
              }>;
            };
          };

          if (best.st?.rt) {
            for (const rtItem of best.st.rt) {
              if (rtItem.ws) {
                for (const wsItem of rtItem.ws) {
                  if (wsItem.cw) {
                    for (const cwItem of wsItem.cw) {
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
      throw new Error("转写结果为空。");
    }

    return text;
  } catch (error) {
    if (error instanceof Error && error.message === "转写结果为空。") {
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
): Promise<string> {
  const config = getXfyunConfig();
  const absolutePath = path.resolve(filePath);

  if (!existsSync(absolutePath)) {
    throw new Error(`音频文件不存在：${absolutePath}`);
  }

  let audioPath = absolutePath;
  let tempConvertedPath: string | null = null;

  try {
    if (await needsConversion(absolutePath, mimeType)) {
      tempConvertedPath = await convertToWav(absolutePath);
      audioPath = tempConvertedPath;
    }

    const orderId = await uploadAudio(audioPath, config);
    const text = await pollResult(orderId, config);

    return text;
  } finally {
    if (tempConvertedPath) {
      try {
        await unlink(tempConvertedPath);
      } catch {
        // 清理临时文件失败不影响主流程
      }
    }
  }
}