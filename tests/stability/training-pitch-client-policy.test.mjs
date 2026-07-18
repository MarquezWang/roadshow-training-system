import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";

const source = await readFile(
  new URL(
    "../../app/training/[sessionId]/training-session/training-session-policy.ts",
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
  PITCH_LIMIT_SEC,
  buildEndPitchRequestBody,
  getPitchElapsedSec,
  getPitchTiming,
  getQaPreparePath,
  getRecordingStatusLabel,
  getTrainingStatusHint,
  getTrainingStatusLabel,
  isPitchEndedStatus,
} = await import(moduleUrl);

test("路演计时使用服务端起点并保留恢复兜底", () => {
  const nowMs = Date.parse("2026-01-01T00:09:00.000Z");

  assert.equal(PITCH_LIMIT_SEC, 540);
  assert.equal(
    getPitchElapsedSec("2026-01-01T00:00:00.000Z", 12, nowMs),
    540,
  );
  assert.equal(getPitchElapsedSec(null, 37, nowMs), 37);
  assert.equal(
    getPitchElapsedSec("2026-01-01T00:10:00.000Z", 12, nowMs),
    0,
  );
});

test("路演剩余时间在超时后归零", () => {
  assert.deepEqual(
    getPitchTiming(
      "2026-01-01T00:00:00.000Z",
      0,
      Date.parse("2026-01-01T00:10:00.000Z"),
    ),
    {
      elapsedSec: 600,
      remainingSec: 0,
    },
  );
});

test("训练状态标签和提示保持未知状态的可诊断文本", () => {
  assert.equal(getTrainingStatusLabel("PITCHING"), "路演中");
  assert.equal(getTrainingStatusHint("CREATED"), "预览中，开始路演后将自动从第 1 页计时。");
  assert.equal(getTrainingStatusHint("FINISHED"), "路演已结束");
  assert.equal(getTrainingStatusLabel("CUSTOM_STATE"), "CUSTOM_STATE");
  assert.equal(getTrainingStatusHint("CUSTOM_STATE"), "CUSTOM_STATE");
  assert.equal(isPitchEndedStatus("PITCH_ENDED"), true);
  assert.equal(isPitchEndedStatus("QA_READY"), false);
});

test("录音状态标签覆盖准备、保存和失败边界", () => {
  assert.equal(getRecordingStatusLabel("READY_TO_RECORD"), "麦克风已就绪");
  assert.equal(getRecordingStatusLabel("SAVED"), "录音已保存");
  assert.equal(
    getRecordingStatusLabel("PERMISSION_DENIED"),
    "麦克风权限未开启",
  );
});

test("结束路演请求体保留页码、时长和材料标识", () => {
  assert.deepEqual(
    buildEndPitchRequestBody({
      fileId: "file-1",
      pageIndex: 4,
      pitchDurationSec: 125,
    }),
    {
      pitchDurationSec: 125,
      pageIndex: 4,
      fileId: "file-1",
    },
  );
});

test("答辩准备路径只在录音存在时附加编码参数", () => {
  assert.equal(
    getQaPreparePath("session-1", "recording/with space"),
    "/training/session-1/qa-prepare?recordingId=recording%2Fwith%20space",
  );
  assert.equal(
    getQaPreparePath("session-1", undefined),
    "/training/session-1/qa-prepare",
  );
});
