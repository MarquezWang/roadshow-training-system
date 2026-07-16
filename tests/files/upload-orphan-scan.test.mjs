import assert from "node:assert/strict";
import { mkdtemp, mkdir, stat, utimes, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { scanUploadTree } from "../../lib/upload-orphan-scan.mjs";

async function exists(target) {
  return Boolean(await stat(target).catch(() => null));
}

test("孤儿扫描默认只读，显式删除只清理过期且未引用的 uploads 路径", async () => {
  const workspaceRoot = await mkdtemp(path.join(os.tmpdir(), "upload-scan-test-"));
  const projectRoot = path.join(workspaceRoot, "uploads", "projects", "p1");
  const previewRoot = path.join(projectRoot, "previews");
  const trashRoot = path.join(workspaceRoot, "uploads", ".trash");
  await Promise.all([
    mkdir(previewRoot, { recursive: true }),
    mkdir(trashRoot, { recursive: true }),
  ]);

  const referenced = path.join(projectRoot, "referenced.pdf");
  const orphan = path.join(projectRoot, "orphan.pdf");
  const recent = path.join(projectRoot, "recent.pdf");
  const temporary = path.join(projectRoot, "upload.abc.tmp");
  const attempt = path.join(previewRoot, ".attempt-old");
  const trash = path.join(trashRoot, "staged-entry");
  await Promise.all([
    writeFile(referenced, "referenced"),
    writeFile(orphan, "orphan"),
    writeFile(recent, "recent"),
    writeFile(temporary, "temporary"),
    mkdir(attempt, { recursive: true }),
    writeFile(trash, "trash"),
  ]);

  const nowMs = Date.now();
  const oldDate = new Date(nowMs - 48 * 60 * 60 * 1_000);
  await Promise.all([
    utimes(orphan, oldDate, oldDate),
    utimes(temporary, oldDate, oldDate),
    utimes(attempt, oldDate, oldDate),
    utimes(trash, oldDate, oldDate),
  ]);

  const references = [
    path.relative(workspaceRoot, referenced),
    path.join("uploads", "projects", "p1", "missing.pdf"),
  ];
  const dryRun = await scanUploadTree({
    workspaceRoot,
    references,
    nowMs,
  });
  assert.equal(dryRun.mode, "read-only");
  assert.deepEqual(dryRun.orphanFiles, ["uploads/projects/p1/orphan.pdf"]);
  assert.deepEqual(dryRun.recentUnreferencedFiles, [
    "uploads/projects/p1/recent.pdf",
  ]);
  assert.deepEqual(dryRun.staleTemporaryFiles, [
    "uploads/projects/p1/upload.abc.tmp",
  ]);
  assert.deepEqual(dryRun.staleAttemptDirectories, [
    "uploads/projects/p1/previews/.attempt-old",
  ]);
  assert.deepEqual(dryRun.staleTrashEntries, ["uploads/.trash/staged-entry"]);
  assert.equal(await exists(orphan), true);

  const deletion = await scanUploadTree({
    workspaceRoot,
    references,
    nowMs,
    deleteStale: true,
  });
  assert.equal(deletion.mode, "delete-stale");
  assert.equal(await exists(referenced), true);
  assert.equal(await exists(recent), true);
  assert.equal(await exists(orphan), false);
  assert.equal(await exists(temporary), false);
  assert.equal(await exists(attempt), false);
  assert.equal(await exists(trash), false);
});
