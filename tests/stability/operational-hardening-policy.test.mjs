import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

async function source(relativePath) {
  return readFile(new URL(relativePath, import.meta.url), "utf8");
}

test("review rule import is atomic and database constraints reject ambiguity", async () => {
  const [importScript, schema] = await Promise.all([
    source("../../scripts/import-review-rule.mjs"),
    source("../../prisma/schema.prisma"),
  ]);

  assert.match(importScript, /prisma\.\$transaction/);
  assert.match(importScript, /transaction\.evaluationCriterion\.deleteMany/);
  assert.match(importScript, /transaction\.evaluationCriterion\.createMany/);
  assert.match(importScript, /upsertKnowledgeSource\(transaction, summary\)/);
  assert.match(schema, /@@unique\(\[ruleId, sortOrder\]\)/);
  assert.match(schema, /@@unique\(\[ruleId, name\]\)/);
});

test("user creation refuses command-line plaintext passwords", async () => {
  const createUser = await source("../../scripts/create-user.mjs");

  assert.match(createUser, /--password 已停用/);
  assert.match(createUser, /--password-stdin/);
  assert.match(createUser, /readHiddenLine/);
  assert.doesNotMatch(createUser, /getArg\("password"\)/);
});

test("microphone permission starts from a user gesture and volume UI is throttled", async () => {
  const [audioInput, statusBar, testPanel, monitor] = await Promise.all([
    source("../../lib/use-audio-input.ts"),
    source("../../components/microphone-status-bar.tsx"),
    source("../../components/microphone-test-panel.tsx"),
    source("../../lib/use-microphone-monitor.ts"),
  ]);

  const refreshBody = audioInput.slice(
    audioInput.indexOf("const refreshDevices"),
    audioInput.indexOf("const setSelectedDeviceId"),
  );
  assert.doesNotMatch(refreshBody, /getUserMedia/);
  assert.match(statusBar, /onClick=\{handleToggleSettings\}/);
  assert.match(testPanel, /onClick=\{\(\) => void startTest\(\)\}/);
  assert.doesNotMatch(testPanel, /挂载时自动启动测试/);
  assert.match(monitor, /VOLUME_UPDATE_INTERVAL_MS = 100/);
  assert.match(monitor, /now - lastUiUpdateTimeRef\.current/);
});
