import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";

const source = await readFile(
  new URL("../../lib/input-limits.ts", import.meta.url),
  "utf8",
);
const output = ts.transpileModule(source, {
  compilerOptions: {
    module: ts.ModuleKind.ESNext,
    target: ts.ScriptTarget.ES2022,
  },
}).outputText;
const inputLimits = await import(
  `data:text/javascript;base64,${Buffer.from(output).toString("base64")}`
);

test("chunked JSON is cancelled as soon as the byte limit is exceeded", async () => {
  const encoder = new TextEncoder();
  let cancelled = false;
  const chunks = [
    encoder.encode('{"value":"'),
    encoder.encode("x".repeat(64)),
    encoder.encode('"}'),
  ];
  const stream = new ReadableStream({
    pull(controller) {
      const chunk = chunks.shift();
      if (chunk) controller.enqueue(chunk);
      else controller.close();
    },
    cancel() {
      cancelled = true;
    },
  });
  const request = new Request("http://localhost/test", {
    method: "POST",
    body: stream,
    duplex: "half",
  });

  await assert.rejects(
    inputLimits.readLimitedJson(request, 16),
    (error) => error instanceof inputLimits.RequestBodyTooLargeError,
  );
  assert.equal(cancelled, true);
  assert.ok(chunks.length > 0, "the reader must stop before consuming all chunks");
});

test("streamed UTF-8 JSON preserves characters split across chunks", async () => {
  const bytes = new TextEncoder().encode('{"value":"路演"}');
  const stream = new ReadableStream({
    start(controller) {
      controller.enqueue(bytes.subarray(0, 11));
      controller.enqueue(bytes.subarray(11, 12));
      controller.enqueue(bytes.subarray(12));
      controller.close();
    },
  });
  const request = new Request("http://localhost/test", {
    method: "POST",
    body: stream,
    duplex: "half",
  });

  assert.deepEqual(await inputLimits.readLimitedJson(request, 64), {
    value: "路演",
  });
});
