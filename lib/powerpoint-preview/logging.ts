import path from "path";

import { PPT_PREVIEW_LOG_PREFIX } from "./constants";

export function sanitizeLogValue(value: string, maxLength = 200) {
  return value.replace(/\s+/g, " ").trim().slice(0, maxLength);
}

export function quoteLogValue(value: string) {
  return `"${sanitizeLogValue(value).replaceAll('"', "'")}"`;
}

export function getShortPath(filePath: string) {
  const relativePath = path.relative(
    /*turbopackIgnore: true*/ process.cwd(),
    filePath,
  );

  if (!relativePath.startsWith("..") && !path.isAbsolute(relativePath)) {
    return relativePath.replaceAll(path.sep, "/");
  }

  return path.basename(filePath);
}

export function logPptPreview(message: string) {
  console.log(`${PPT_PREVIEW_LOG_PREFIX} ${message}`);
}

export function warnPptPreview(message: string) {
  console.warn(`${PPT_PREVIEW_LOG_PREFIX} ${message}`);
}
