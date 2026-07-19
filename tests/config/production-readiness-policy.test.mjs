import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("production readiness checks cover media tools, storage and resource bounds", async () => {
  const source = await readFile(
    new URL("../../scripts/check-prod-config.mjs", import.meta.url),
    "utf8",
  );

  assert.match(source, /findCommand\("ffprobe"\)/);
  assert.match(source, /findCommand\("ffmpeg"\)/);
  assert.match(source, /statfsSync/);
  assert.match(source, /UPLOAD_MAINTENANCE_ENABLED/);
  assert.match(source, /TRUSTED_PROXY_HOPS/);
  assert.match(source, /TRANSCRIPTION_MAX_CONCURRENCY/);
  assert.match(source, /TRANSCRIPTION_MAX_AUDIO_BYTES/);
  assert.match(source, /TRANSCRIPTION_MAX_DURATION_SEC/);
  assert.match(source, /BACKGROUND_TASK_MODE/);
  assert.match(source, /BACKGROUND_WORKER_HEARTBEAT_TTL_MS/);
  assert.match(source, /readBackgroundWorkerHealth/);
  assert.match(source, /TRAINING_TRANSCRIPTION_CAPABILITY/);
  assert.match(source, /TRAINING_ANALYSIS_CAPABILITY/);
  assert.match(source, /UPLOAD_MAINTENANCE_CAPABILITY/);
});
