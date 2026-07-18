import { mkdir, writeFile } from "fs/promises";
import path from "path";

export const XFYUN_DEBUG_DIR = path.join(
  /* turbopackIgnore: true */ process.cwd(),
  "tmp",
  "xfyun-debug",
);
export const XFYUN_DEBUG = process.env.XFYUN_DEBUG === "true";
export const KEEP_XFYUN_TEMP_AUDIO =
  process.env.XFYUN_KEEP_TEMP_AUDIO === "true";

export function xfyunDebugLog(...args: unknown[]) {
  if (XFYUN_DEBUG) console.log(...args);
}

export async function saveXfyunDebugJson(
  debugDir: string,
  filename: string,
  rawJson: string,
): Promise<void> {
  if (!XFYUN_DEBUG) return;
  try {
    await mkdir(debugDir, { recursive: true });
    await writeFile(path.join(debugDir, filename), rawJson, "utf-8");
    xfyunDebugLog(`[xfyun debug] saved: ${filename}`);
  } catch {
    xfyunDebugLog(`[xfyun debug] 无法保存调试文件：${filename}`);
  }
}
