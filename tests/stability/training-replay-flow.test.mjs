import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";

const source = await readFile(
  new URL(
    "../../app/training/[sessionId]/replay/training-replay/training-replay-flow.ts",
    import.meta.url,
  ),
  "utf8",
);
const transpiled = ts.transpileModule(source, {
  compilerOptions: {
    module: ts.ModuleKind.ESNext,
    target: ts.ScriptTarget.ES2022,
  },
}).outputText;
const moduleUrl = `data:text/javascript;base64,${Buffer.from(transpiled).toString("base64")}`;
const {
  buildPitchReplaySegments,
  formatReplayTime,
  getReplayPageControlItems,
  getTranscriptExcerptForSegment,
  parseTranscriptSegments,
} = await import(moduleUrl);

function slideEvent(id, pageIndex, elapsedSec, eventType = "PAGE") {
  return {
    id,
    fileId: "file-1",
    pageIndex,
    eventType,
    elapsedSec,
    createdAt: `2026-01-01T00:00:${String(elapsedSec).padStart(2, "0")}.000Z`,
  };
}

test("无翻页事件时使用训练时长生成第一页回放片段", () => {
  assert.deepEqual(buildPitchReplaySegments([], 45), [
    {
      pageIndex: 1,
      startSec: 0,
      endSec: 45,
      durationSec: 45,
      ranges: [{ startSec: 0, endSec: 45 }],
    },
  ]);
  assert.deepEqual(buildPitchReplaySegments([], null), []);
});

test("回放时间轴排序事件并累计同一页面的多段停留时间", () => {
  const segments = buildPitchReplaySegments(
    [
      slideEvent("page-1-return", 1, 25),
      slideEvent("end", 1, 40, "END"),
      slideEvent("start", 1, 0, "START"),
      slideEvent("page-2", 2, 10),
    ],
    40,
  );

  assert.deepEqual(segments, [
    {
      pageIndex: 1,
      startSec: 0,
      endSec: 10,
      durationSec: 25,
      ranges: [
        { startSec: 0, endSec: 10 },
        { startSec: 25, endSec: 40 },
      ],
    },
    {
      pageIndex: 2,
      startSec: 10,
      endSec: 25,
      durationSec: 15,
      ranges: [{ startSec: 10, endSec: 25 }],
    },
  ]);
});

test("长页面列表只展示当前页附近与首尾控制项", () => {
  assert.deepEqual(getReplayPageControlItems(12, 5), [
    0,
    1,
    "ellipsis",
    3,
    4,
    5,
    6,
    7,
    "ellipsis",
    10,
    11,
  ]);
  assert.deepEqual(getReplayPageControlItems(3, 1), [0, 1, 2]);
});

test("转写时间戳解析会过滤无效项并按开始时间排序", () => {
  const segments = parseTranscriptSegments(
    JSON.stringify([
      { startMs: 2000, endMs: 3000, text: " 第二句 " },
      { startMs: 1000, endMs: 1500, text: "第一句", speakerId: "speaker-1" },
      { startMs: 4000, endMs: 4000, text: "无效区间" },
      { startMs: 5000, endMs: 6000, text: "   " },
      null,
    ]),
  );

  assert.deepEqual(segments, [
    {
      startMs: 1000,
      endMs: 1500,
      text: "第一句",
      speakerId: "speaker-1",
    },
    {
      startMs: 2000,
      endMs: 3000,
      text: "第二句",
      speakerId: null,
    },
  ]);
  assert.deepEqual(parseTranscriptSegments("not-json"), []);
});

test("页面转写优先使用时间戳精确匹配", () => {
  const excerpt = getTranscriptExcerptForSegment(
    "完整转写不会被使用",
    JSON.stringify([
      { startMs: 5000, endMs: 8000, text: "第一句。" },
      { startMs: 8000, endMs: 12000, text: "第二句。" },
      { startMs: 15000, endMs: 16000, text: "边界外。" },
    ]),
    {
      pageIndex: 2,
      startSec: 5,
      endSec: 15,
      durationSec: 10,
      ranges: [{ startSec: 5, endSec: 15 }],
    },
    60,
  );

  assert.deepEqual(excerpt, {
    text: "第一句。第二句。",
    matchType: "precise",
  });
});

test("缺少有效时间戳时按页面时长比例估算转写片段", () => {
  const excerpt = getTranscriptExcerptForSegment(
    "ABCDEFGHIJ",
    null,
    {
      pageIndex: 2,
      startSec: 20,
      endSec: 40,
      durationSec: 20,
      ranges: [{ startSec: 20, endSec: 40 }],
    },
    100,
  );

  assert.deepEqual(excerpt, { text: "CD", matchType: "estimated" });
  assert.equal(formatReplayTime(65.9), "01:05");
  assert.equal(formatReplayTime(Number.NaN), "00:00");
});
