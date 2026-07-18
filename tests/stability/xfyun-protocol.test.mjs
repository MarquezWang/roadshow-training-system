import assert from "node:assert/strict";
import { createHash, createHmac } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";

function transpileToDataUrl(source) {
  const output = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.ESNext,
      target: ts.ScriptTarget.ES2022,
    },
  }).outputText;

  return `data:text/javascript;base64,${Buffer.from(output).toString("base64")}`;
}

const transcribeErrorSource = await readFile(
  new URL("../../lib/transcribe-error.ts", import.meta.url),
  "utf8",
);
const transcribeErrorUrl = transpileToDataUrl(transcribeErrorSource);
const protocolSource = (
  await readFile(
    new URL("../../lib/transcription/xfyun/protocol.ts", import.meta.url),
    "utf8",
  )
).replace('from "@/lib/transcribe-error"', `from "${transcribeErrorUrl}"`);
const protocol = await import(transpileToDataUrl(protocolSource));
const { TranscribeBusinessError } = await import(transcribeErrorUrl);
const protocolUrl = transpileToDataUrl(protocolSource);
const configSource = await readFile(
  new URL("../../lib/transcription/xfyun/config.ts", import.meta.url),
  "utf8",
);
const { generateXfyunSigna } = await import(transpileToDataUrl(configSource));
const transcriptErrorMessageUrl = transpileToDataUrl(
  await readFile(
    new URL("../../lib/transcript-error-message.ts", import.meta.url),
    "utf8",
  ),
);
const transcriptionAbortUrl = transpileToDataUrl(
  await readFile(
    new URL("../../lib/transcription-abort.mjs", import.meta.url),
    "utf8",
  ),
);
const clientStubUrl = transpileToDataUrl(
  'export async function getXfyunResultOnce() { throw new Error("unexpected default client call"); }',
);
const debugStubUrl = transpileToDataUrl("export function xfyunDebugLog() {}");
const pollingSource = (
  await readFile(
    new URL("../../lib/transcription/xfyun/polling.ts", import.meta.url),
    "utf8",
  )
)
  .replace('from "@/lib/transcribe-error"', `from "${transcribeErrorUrl}"`)
  .replace(
    'from "@/lib/transcript-error-message"',
    `from "${transcriptErrorMessageUrl}"`,
  )
  .replace(
    'from "@/lib/transcription-abort.mjs"',
    `from "${transcriptionAbortUrl}"`,
  )
  .replace('from "./client"', `from "${clientStubUrl}"`)
  .replace('from "./debug"', `from "${debugStubUrl}"`)
  .replace('from "./protocol"', `from "${protocolUrl}"`);
const { pollXfyunResult } = await import(transpileToDataUrl(pollingSource));
const {
  classifyXfyunPollResponse,
  extractTextFromXfyunResult,
  hasXfyunOrderResult,
} = protocol;

function resultBody(status, orderResult) {
  const content = {
    orderInfo: {
      orderId: "order-1",
      failType: status === -1 ? 6 : 0,
      status,
    },
  };

  if (arguments.length > 1) {
    content.orderResult = orderResult;
  }

  return {
    code: "000000",
    descInfo: "success",
    content,
  };
}

function bestResult(text) {
  return {
    st: {
      rt: [
        {
          ws: [
            {
              cw: [
                { w: text.slice(0, 1) },
                { w: "分段", wp: "g" },
                { w: text.slice(1) },
              ],
            },
          ],
        },
      ],
    },
  };
}

function pollingFixture(bodies) {
  const variants = [];
  const delays = [];

  return {
    variants,
    delays,
    dependencies: {
      async getResultOnce(_orderId, variant) {
        variants.push(variant.name);
        const body = bodies.shift();
        assert.ok(body, `missing fixture response for ${variant.name}`);
        return { body, variantName: variant.name };
      },
      async delay(milliseconds) {
        delays.push(milliseconds);
      },
      now() {
        return 0;
      },
    },
  };
}

const pollingConfig = {
  appId: "app-id",
  secretKey: "secret",
  language: "cn",
};
const uploadInfo = {
  uploadFileName: "answer.wav",
  uploadFileSize: 1_024,
  uploadDurationMs: 2_000,
  audioInfo: {
    durationSeconds: 2,
    codec: "pcm_s16le",
    sampleRate: "16000",
    channels: "1",
  },
};

test("讯飞签名保持 MD5 后 HMAC-SHA1 的协议契约", () => {
  const appId = "app-id";
  const timestamp = "1710000000";
  const secret = "secret-key";
  const md5 = createHash("md5")
    .update(`${appId}${timestamp}`, "utf8")
    .digest("hex");
  const expected = createHmac("sha1", secret)
    .update(md5, "utf8")
    .digest("base64");

  assert.equal(generateXfyunSigna(appId, timestamp, secret), expected);
});

test("讯飞轮询协议会区分查询错误和缺失订单信息", () => {
  assert.deepEqual(
    classifyXfyunPollResponse({ code: "101", descInfo: "invalid" }),
    { kind: "query_error" },
  );
  assert.deepEqual(
    classifyXfyunPollResponse({ code: "000000", descInfo: "success" }),
    { kind: "missing_order_info" },
  );
});

test("讯飞轮询协议会区分失败、处理中和未知状态", () => {
  assert.equal(classifyXfyunPollResponse(resultBody(-1)).kind, "failed");
  assert.equal(classifyXfyunPollResponse(resultBody(0)).kind, "processing");
  assert.equal(classifyXfyunPollResponse(resultBody(3)).kind, "processing");
  assert.equal(classifyXfyunPollResponse(resultBody(2)).kind, "unknown");
});

test("讯飞完成状态会显式区分空结果和有效结果", () => {
  const empty = classifyXfyunPollResponse(resultBody(4, ""));
  const completed = classifyXfyunPollResponse(resultBody(4, { lattice: [] }));

  assert.equal(empty.kind, "completed");
  assert.equal(empty.hasOrderResult, false);
  assert.equal(completed.kind, "completed");
  assert.equal(completed.hasOrderResult, true);
  assert.equal(hasXfyunOrderResult(null), false);
  assert.equal(hasXfyunOrderResult(""), false);
  assert.equal(hasXfyunOrderResult({}), true);
});

test("讯飞结果优先解析 lattice2 并跳过分段标记", () => {
  const text = extractTextFromXfyunResult({
    lattice: [{ json_1best: bestResult("旧值") }],
    lattice2: [{ json_1best: JSON.stringify(bestResult("你好")) }],
  });

  assert.equal(text, "你好");
});

test("讯飞结果解析保留原有错误契约", () => {
  assert.throws(
    () => extractTextFromXfyunResult("not-json"),
    /解析 orderResult JSON 失败/,
  );
  assert.throws(
    () => extractTextFromXfyunResult(42),
    /orderResult 不是有效的字符串或对象/,
  );
  assert.throws(
    () => extractTextFromXfyunResult({ lattice: [] }),
    (error) =>
      error instanceof TranscribeBusinessError &&
      error.userMessage.includes("转写结果为空"),
  );
});

test("讯飞轮询从处理中进入完成时保持主变体顺序", async () => {
  const fixture = pollingFixture([
    resultBody(0),
    resultBody(4, {
      lattice: [{ json_1best: bestResult("完成") }],
    }),
  ]);

  const text = await pollXfyunResult(
    "order-1",
    pollingConfig,
    uploadInfo,
    "debug-dir",
    null,
    new AbortController().signal,
    fixture.dependencies,
  );

  assert.equal(text, "完成");
  assert.deepEqual(fixture.variants, ["GET_DEFAULT", "GET_DEFAULT"]);
  assert.deepEqual(fixture.delays, [5_000]);
});

test("讯飞完成但主结果为空时按 B/C/D 变体依次回退", async () => {
  const fixture = pollingFixture([
    resultBody(4, ""),
    resultBody(4, null),
    resultBody(4, {
      lattice2: [{ json_1best: bestResult("回退成功") }],
    }),
  ]);

  const text = await pollXfyunResult(
    "order-1",
    pollingConfig,
    uploadInfo,
    "debug-dir",
    null,
    new AbortController().signal,
    fixture.dependencies,
  );

  assert.equal(text, "回退成功");
  assert.deepEqual(fixture.variants, [
    "GET_DEFAULT",
    "GET_TRANSFER",
    "POST_FORM_DEFAULT",
  ]);
  assert.deepEqual(fixture.delays, []);
});
