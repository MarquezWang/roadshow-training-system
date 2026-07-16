import { appendFile, mkdir, readFile, stat, writeFile } from "fs/promises";
import path from "path";

export type DiagnosticEventType =
  | "AI_ERROR"
  | "ASR_ERROR"
  | "PPT_PREVIEW_ERROR"
  | "REPORT_ERROR"
  | "SYSTEM_TEST";

export type DiagnosticEvent = {
  ts: string;
  type: DiagnosticEventType;
  message: string;
  meta?: Record<string, string | number | boolean | null>;
};

const DIAGNOSTIC_DIR = path.join(
  /*turbopackIgnore: true*/ process.cwd(),
  "data",
);
const DIAGNOSTIC_FILE = path.join(DIAGNOSTIC_DIR, "diagnostics.jsonl");
const MAX_LOG_FILE_BYTES = 512 * 1024;
let diagnosticWriteQueue: Promise<void> = Promise.resolve();

function sanitizeMessage(message: string) {
  return message
    .replace(/sk-[A-Za-z0-9_-]+/g, "[redacted]")
    .replace(/Bearer\s+[A-Za-z0-9._-]+/g, "Bearer [redacted]")
    .replace(/TENCENT_SECRET_KEY\s*=\s*\S+/gi, "TENCENT_SECRET_KEY=[redacted]")
    .replace(/AI_API_KEY\s*=\s*\S+/gi, "AI_API_KEY=[redacted]")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 300);
}

function sanitizeMeta(meta?: DiagnosticEvent["meta"]) {
  if (!meta) {
    return undefined;
  }

  return Object.fromEntries(
    Object.entries(meta).map(([key, value]) => [
      key,
      typeof value === "string" ? sanitizeMessage(value) : value,
    ]),
  );
}

async function trimLogFileIfNeeded() {
  try {
    const fileStat = await stat(DIAGNOSTIC_FILE);

    if (fileStat.size <= MAX_LOG_FILE_BYTES) {
      return;
    }

    const content = await readFile(DIAGNOSTIC_FILE, "utf8");
    const lines = content.trim().split("\n").slice(-200);
    await writeFile(DIAGNOSTIC_FILE, `${lines.join("\n")}\n`, "utf8");
  } catch {
    // No-op: diagnostics must never break business flow.
  }
}

async function appendDiagnosticEvent(
  event: Omit<DiagnosticEvent, "ts">,
) {
  try {
    await mkdir(DIAGNOSTIC_DIR, { recursive: true });
    await trimLogFileIfNeeded();
    const entry: DiagnosticEvent = {
      ts: new Date().toISOString(),
      type: event.type,
      message: sanitizeMessage(event.message),
      meta: sanitizeMeta(event.meta),
    };
    await appendFile(DIAGNOSTIC_FILE, `${JSON.stringify(entry)}\n`, "utf8");
  } catch {
    // No-op: diagnostics must never break business flow.
  }
}

export function writeDiagnosticEvent(event: Omit<DiagnosticEvent, "ts">) {
  const write = diagnosticWriteQueue.then(() => appendDiagnosticEvent(event));
  diagnosticWriteQueue = write.catch(() => undefined);
  return write;
}

export async function readRecentDiagnosticEvents(limit = 20) {
  try {
    const content = await readFile(DIAGNOSTIC_FILE, "utf8");
    return content
      .trim()
      .split("\n")
      .filter(Boolean)
      .slice(-limit)
      .reverse()
      .flatMap((line) => {
        try {
          return [JSON.parse(line) as DiagnosticEvent];
        } catch {
          return [];
        }
      });
  } catch {
    return [];
  }
}
