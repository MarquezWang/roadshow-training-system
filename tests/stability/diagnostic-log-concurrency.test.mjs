import assert from "node:assert/strict";
import { appendFile, mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import ts from "typescript";

test("diagnostic log 并发追加不丢事件，损坏单行不影响其余记录", async () => {
  const tempDirectory = await mkdtemp(path.join(os.tmpdir(), "roadshow-diagnostics-"));
  const originalCwd = process.cwd();

  try {
    process.chdir(tempDirectory);
    const source = await readFile(
      new URL("../../lib/diagnostic-log.ts", import.meta.url),
      "utf8",
    );
    const transpiled = ts.transpileModule(source, {
      compilerOptions: {
        module: ts.ModuleKind.ESNext,
        target: ts.ScriptTarget.ES2022,
        esModuleInterop: true,
      },
    }).outputText;
    const { readRecentDiagnosticEvents, writeDiagnosticEvent } = await import(
      `data:text/javascript;base64,${Buffer.from(transpiled).toString("base64")}`
    );

    await Promise.all(
      Array.from({ length: 100 }, (_, index) =>
        writeDiagnosticEvent({
          type: "SYSTEM_TEST",
          message: `concurrent-event-${index}`,
        }),
      ),
    );
    await appendFile(
      path.join(tempDirectory, "data", "diagnostics.jsonl"),
      "{malformed-json\n",
      "utf8",
    );

    const events = await readRecentDiagnosticEvents(200);
    assert.equal(events.length, 100);
    assert.equal(new Set(events.map((event) => event.message)).size, 100);
  } finally {
    process.chdir(originalCwd);
    await rm(tempDirectory, { recursive: true, force: true });
  }
});
