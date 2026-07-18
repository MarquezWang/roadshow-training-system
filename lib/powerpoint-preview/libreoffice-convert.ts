import { mkdir, readdir, rm, stat } from "fs/promises";
import path from "path";
import { pathToFileURL } from "url";

import { runBoundedProcess } from "@/lib/bounded-process.mjs";
import { createDocumentParseLimiter } from "@/lib/document-parser-boundary.mjs";
import {
  CONVERSION_QUEUE_TIMEOUT_MS,
  CONVERSION_TIMEOUT_MS,
  MAX_ATTEMPT_DIRECTORY_BYTES,
} from "./constants";
import { getErrorMessage, PowerPointPreviewError } from "./errors";
import { checkLibreOfficeAvailability } from "./libreoffice-availability";
import { sanitizeLogValue } from "./logging";

const libreOfficeLimiter = createDocumentParseLimiter(
  Number(process.env.LIBREOFFICE_MAX_CONCURRENCY) || 1,
);

async function getDirectorySize(directoryPath: string): Promise<number> {
  let total = 0;
  const entries = await readdir(directoryPath, { withFileTypes: true });
  for (const entry of entries) {
    const entryPath = path.join(directoryPath, entry.name);
    if (entry.isDirectory()) {
      total += await getDirectorySize(entryPath);
    } else if (entry.isFile()) {
      total += (await stat(entryPath)).size;
    }
    if (total > MAX_ATTEMPT_DIRECTORY_BYTES) return total;
  }
  return total;
}

export async function runLibreOfficeConvert(
  inputPath: string,
  outputDir: string,
) {
  const libreOffice = await checkLibreOfficeAvailability();

  if (!libreOffice.available) {
    throw new PowerPointPreviewError(
      "libreoffice_unavailable",
      "当前环境未配置 PPT 转换组件（LibreOffice）。",
    );
  }

  const profilePath = path.join(outputDir, ".lo-profile");
  const temporaryPath = path.join(outputDir, ".lo-tmp");
  await Promise.all([
    mkdir(profilePath, { recursive: true }),
    mkdir(temporaryPath, { recursive: true }),
  ]);

  const args = [
    `-env:UserInstallation=${pathToFileURL(profilePath).href}`,
    "--headless",
    "--invisible",
    "--nologo",
    "--nodefault",
    "--nofirststartwizard",
    "--nolockcheck",
    "--norestore",
    "--convert-to",
    "pdf",
    "--outdir",
    outputDir,
    inputPath,
  ];

  const release = await libreOfficeLimiter.acquire({
    timeoutMs: CONVERSION_QUEUE_TIMEOUT_MS,
  });
  const controller = new AbortController();
  let directoryLimitExceeded = false;
  const monitor = setInterval(() => {
    void getDirectorySize(outputDir)
      .then((size) => {
        if (size > MAX_ATTEMPT_DIRECTORY_BYTES && !controller.signal.aborted) {
          directoryLimitExceeded = true;
          controller.abort();
        }
      })
      .catch(() => undefined);
  }, 500);

  try {
    await runBoundedProcess(libreOffice.command, args, {
      timeoutMs: CONVERSION_TIMEOUT_MS,
      maxOutputBytes: 512 * 1024,
      signal: controller.signal,
      env: {
        ...process.env,
        HOME: temporaryPath,
        TEMP: temporaryPath,
        TMP: temporaryPath,
        SAL_DISABLE_OPENCL: "1",
        SAL_USE_VCLPLUGIN: "svp",
        http_proxy: "http://127.0.0.1:9",
        https_proxy: "http://127.0.0.1:9",
        HTTP_PROXY: "http://127.0.0.1:9",
        HTTPS_PROXY: "http://127.0.0.1:9",
        ALL_PROXY: "http://127.0.0.1:9",
        all_proxy: "http://127.0.0.1:9",
        NO_PROXY: "",
        no_proxy: "",
      },
    });
  } catch (error) {
    throw new PowerPointPreviewError(
      "libreoffice_execution_failed",
      directoryLimitExceeded
        ? "PPT 展示预览生成失败：临时文件超过 150MB，已终止转换。"
        : `PPT 展示预览生成失败：${sanitizeLogValue(getErrorMessage(error))}`,
    );
  } finally {
    clearInterval(monitor);
    controller.abort();
    release();
    await Promise.all([
      rm(profilePath, { recursive: true, force: true }),
      rm(temporaryPath, { recursive: true, force: true }),
    ]).catch(() => undefined);
  }
}
