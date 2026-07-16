import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";

const source = await readFile(
  new URL("../../lib/file-upload.ts", import.meta.url),
  "utf8",
);
const transpiled = ts.transpileModule(source, {
  compilerOptions: {
    module: ts.ModuleKind.ESNext,
    target: ts.ScriptTarget.ES2022,
    esModuleInterop: true,
  },
}).outputText;
const { isSupportedUploadFile, validateProjectFileSignature } = await import(
  `data:text/javascript;base64,${Buffer.from(transpiled).toString("base64")}`
);

test("upload allowlist no longer promises legacy binary PPT support", () => {
  assert.equal(isSupportedUploadFile("deck.ppt"), false);
  assert.equal(isSupportedUploadFile("deck.pptx"), true);
  assert.equal(isSupportedUploadFile("document.pdf"), true);
});

test("file signatures reject renamed binary payloads", () => {
  assert.throws(
    () => validateProjectFileSignature("document.pdf", Buffer.from("not a pdf")),
    /不是有效的 PDF/,
  );
  assert.throws(
    () => validateProjectFileSignature("deck.pptx", Buffer.from("not a zip")),
    /Office 文件结构无效/,
  );
  assert.throws(
    () =>
      validateProjectFileSignature(
        "notes.txt",
        Buffer.from([0x61, 0x00, 0x62]),
      ),
    /二进制内容/,
  );
});

test("valid PDF and ZIP headers pass signature checks", () => {
  assert.doesNotThrow(() =>
    validateProjectFileSignature("document.pdf", Buffer.from("%PDF-1.7\n")),
  );
  assert.doesNotThrow(() =>
    validateProjectFileSignature(
      "deck.pptx",
      Buffer.from([0x50, 0x4b, 0x03, 0x04, 0x00]),
    ),
  );
});
