import { runBoundedProcess } from "@/lib/bounded-process.mjs";
import { DETECTION_TIMEOUT_MS } from "./constants";
import { getErrorMessage } from "./errors";
import {
  logPptPreview,
  quoteLogValue,
  sanitizeLogValue,
  warnPptPreview,
} from "./logging";
import type { LibreOfficeCheckResult } from "./types";

function getLibreOfficeCandidates() {
  return [
    process.env.LIBREOFFICE_PATH,
    "libreoffice",
    "soffice",
    "soffice.exe",
  ].filter((value): value is string => Boolean(value));
}

function isCommandNotFoundError(message: string) {
  return /ENOENT|not recognized|找不到|无法将|not found/i.test(message);
}

export async function checkLibreOfficeAvailability(): Promise<LibreOfficeCheckResult> {
  const errors: string[] = [];

  for (const command of getLibreOfficeCandidates()) {
    try {
      const result = await runBoundedProcess(command, ["--version"], {
        timeoutMs: DETECTION_TIMEOUT_MS,
        maxOutputBytes: 64 * 1024,
      });
      const version = sanitizeLogValue(
        result.stdout || result.stderr || "version unavailable",
      );

      logPptPreview(
        `libreoffice found command=${command} version=${quoteLogValue(
          version,
        )}`,
      );

      return {
        available: true,
        command,
        version,
      };
    } catch (error) {
      errors.push(`${command}: ${sanitizeLogValue(getErrorMessage(error))}`);
    }
  }

  const reason = errors.every(isCommandNotFoundError)
    ? "command not found"
    : sanitizeLogValue(errors.join("; "));
  warnPptPreview(`libreoffice unavailable reason=${quoteLogValue(reason)}`);

  return {
    available: false,
    reason,
    errors,
  };
}
