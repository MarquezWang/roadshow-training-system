import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { access, mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

import JSZip from "jszip";

import {
  DocumentArchiveLimitError,
  inspectDocumentArchive,
} from "../../lib/document-archive-guard.mjs";
import {
  createDocumentParseLimiter,
  DocumentParserBoundaryError,
  runDocumentParserWorker,
  withTemporaryDocumentFile,
} from "../../lib/document-parser-boundary.mjs";
import {
  BoundedProcessError,
  runBoundedProcess,
} from "../../lib/bounded-process.mjs";

async function makePptx(slideText = "safe slide") {
  const zip = new JSZip();
  zip.file("[Content_Types].xml", "<Types />");
  zip.file(
    "ppt/slides/slide1.xml",
    `<p:sld><a:t>${slideText}</a:t></p:sld>`,
  );
  return zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });
}

function makePdf(text = "worker pdf") {
  const content = `BT /F1 12 Tf 72 720 Td (${text}) Tj ET`;
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    `<< /Length ${Buffer.byteLength(content)} >>\nstream\n${content}\nendstream`,
  ];
  let body = "%PDF-1.4\n";
  const offsets = [0];
  for (let index = 0; index < objects.length; index += 1) {
    offsets.push(Buffer.byteLength(body));
    body += `${index + 1} 0 obj\n${objects[index]}\nendobj\n`;
  }
  const xrefOffset = Buffer.byteLength(body);
  body += `xref\n0 ${objects.length + 1}\n`;
  body += "0000000000 65535 f \n";
  for (const offset of offsets.slice(1)) {
    body += `${String(offset).padStart(10, "0")} 00000 n \n`;
  }
  body += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\n`;
  body += `startxref\n${xrefOffset}\n%%EOF\n`;
  return Buffer.from(body, "ascii");
}

test("Office archive central directory is checked before extraction", async (t) => {
  await t.test("a normal PPTX remains accepted", async () => {
    const archive = await makePptx();
    const result = inspectDocumentArchive(archive);
    assert.ok(result.entryCount >= 2);
    assert.ok(result.totalXmlBytes > 0);
  });

  await t.test("abnormal compression ratios are rejected", async () => {
    const zip = new JSZip();
    zip.file("ppt/slides/slide1.xml", "x".repeat(1_100_000));
    const archive = await zip.generateAsync({
      type: "nodebuffer",
      compression: "DEFLATE",
    });
    assert.throws(
      () => inspectDocumentArchive(archive, { maxCompressionRatio: 2 }),
      (error) =>
        error instanceof DocumentArchiveLimitError &&
        error.code === "SUSPICIOUS_COMPRESSION_RATIO",
    );
  });

  await t.test("unsafe archive paths are rejected", async () => {
    const archive = await makePptx();
    const name = Buffer.from("ppt/slides/slide1.xml");
    const replacement = Buffer.alloc(name.length, 0x20);
    replacement.write("../unsafe.xml");
    assert.equal(name.length, replacement.length);
    const centralOffset = archive.lastIndexOf(name);
    assert.ok(centralOffset > 0);
    replacement.copy(archive, centralOffset);
    assert.throws(
      () => inspectDocumentArchive(archive),
      (error) =>
        error instanceof DocumentArchiveLimitError &&
        error.code === "UNSAFE_ENTRY_PATH",
    );
  });
});

test("document parser worker is isolated, bounded and cancellable", async (t) => {
  const temporaryRoot = path.resolve(
    "tmp",
    `document-parser-test-${randomUUID()}`,
  );
  await mkdir(temporaryRoot, { recursive: true });

  try {
    await t.test("a normal PPTX is parsed by the worker", async () => {
      const inputPath = path.join(temporaryRoot, "normal.pptx");
      await writeFile(inputPath, await makePptx("worker result"));
      const result = await runDocumentParserWorker({
        inputPath,
        fileType: "pptx",
        timeoutMs: 10_000,
      });
      assert.equal(result, "worker result");
    });

    await t.test("a normal PDF is parsed by the worker", async () => {
      const inputPath = path.join(temporaryRoot, "normal.pdf");
      await writeFile(inputPath, makePdf("worker pdf"));
      const result = await runDocumentParserWorker({
        inputPath,
        fileType: "pdf",
        timeoutMs: 10_000,
      });
      assert.match(result, /worker pdf/);
    });

    await t.test("a hard timeout terminates a CPU-bound worker", async () => {
      const startedAt = Date.now();
      await assert.rejects(
        runDocumentParserWorker({
          inputPath: "unused",
          fileType: "txt",
          timeoutMs: 50,
          workerPath: path.resolve(
            "tests",
            "fixtures",
            "hanging-document-parser.mjs",
          ),
        }),
        (error) =>
          error instanceof DocumentParserBoundaryError &&
          error.code === "TIMEOUT",
      );
      assert.ok(Date.now() - startedAt < 2_000);
    });

    await t.test("temporary inputs are deleted after parser failure", async () => {
      let temporaryPath = "";
      await assert.rejects(
        withTemporaryDocumentFile(
          Buffer.from("temporary"),
          "txt",
          async (filePath) => {
            temporaryPath = filePath;
            throw new Error("parse failed");
          },
          { temporaryRoot: path.join(temporaryRoot, "cleanup") },
        ),
        /parse failed/,
      );
      await assert.rejects(access(temporaryPath));
    });
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true });
  }
});

test("document parser concurrency limiter does not exceed its configured slot count", async () => {
  const limiter = createDocumentParseLimiter(1);
  const firstRelease = await limiter.acquire();
  let secondAcquired = false;
  const second = limiter.acquire().then((release) => {
    secondAcquired = true;
    release();
  });

  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(limiter.activeCount, 1);
  assert.equal(limiter.pendingCount, 1);
  assert.equal(secondAcquired, false);
  firstRelease();
  await second;
  assert.equal(limiter.activeCount, 0);
});

test("bounded child processes are terminated on timeout and output overflow", async (t) => {
  await t.test("timeout stops a long-running process", async () => {
    const startedAt = Date.now();
    await assert.rejects(
      runBoundedProcess(
        process.execPath,
        ["-e", "setInterval(() => {}, 1000)"],
        { timeoutMs: 100 },
      ),
      (error) =>
        error instanceof BoundedProcessError && error.code === "TIMEOUT",
    );
    assert.ok(Date.now() - startedAt < 3_000);
  });

  await t.test("excessive process output is rejected", async () => {
    await assert.rejects(
      runBoundedProcess(
        process.execPath,
        ["-e", "process.stdout.write('x'.repeat(200000))"],
        { timeoutMs: 5_000, maxOutputBytes: 1_024 },
      ),
      (error) =>
        error instanceof BoundedProcessError && error.code === "OUTPUT_LIMIT",
    );
  });
});
