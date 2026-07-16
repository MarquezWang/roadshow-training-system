import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { stageUploadEntries } from "../../lib/file-lifecycle.mjs";

async function exists(target) {
  return Boolean(await stat(target).catch(() => null));
}

test("upload lifecycle staging supports rollback, commit and concurrent deletion", async (t) => {
  const workspaceRoot = await mkdtemp(
    path.join(os.tmpdir(), "file-lifecycle-test-"),
  );
  t.after(() => rm(workspaceRoot, { recursive: true, force: true }));
  const projectRoot = path.join(workspaceRoot, "uploads", "projects", "p1");
  await mkdir(projectRoot, { recursive: true });

  await t.test("database failure rolls staged files back to their original paths", async () => {
    const source = path.join(projectRoot, "rollback.pdf");
    await writeFile(source, "rollback");
    const staged = await stageUploadEntries({
      workspaceRoot,
      paths: [source],
    });
    assert.equal(staged.stagedCount, 1);
    assert.equal(await exists(source), false);
    assert.equal(await staged.rollback(), true);
    assert.equal((await readFile(source, "utf8")), "rollback");
  });

  await t.test("commit permanently purges staged files", async () => {
    const source = path.join(projectRoot, "commit.pdf");
    await writeFile(source, "commit");
    const staged = await stageUploadEntries({
      workspaceRoot,
      paths: [source],
    });
    assert.equal(await staged.commit(), true);
    assert.equal(await exists(source), false);
  });

  await t.test("nested candidates are staged once", async () => {
    const directory = path.join(projectRoot, "nested");
    const child = path.join(directory, "child.pdf");
    await mkdir(directory, { recursive: true });
    await writeFile(child, "nested");
    const staged = await stageUploadEntries({
      workspaceRoot,
      paths: [directory, child],
    });
    assert.equal(staged.stagedCount, 1);
    await staged.rollback();
    assert.equal(await exists(child), true);
  });

  await t.test("concurrent staging treats the losing rename as idempotent", async () => {
    const source = path.join(projectRoot, "concurrent.pdf");
    await writeFile(source, "concurrent");
    const results = await Promise.all([
      stageUploadEntries({ workspaceRoot, paths: [source] }),
      stageUploadEntries({ workspaceRoot, paths: [source] }),
    ]);
    assert.equal(
      results.reduce((total, result) => total + result.stagedCount, 0),
      1,
    );
    assert.equal(
      results.reduce((total, result) => total + result.contendedCount, 0),
      1,
    );
    await Promise.all(results.map((result) => result.commit()));
    assert.equal(await exists(source), false);
  });

  await t.test("paths outside uploads are rejected", async () => {
    await assert.rejects(
      stageUploadEntries({
        workspaceRoot,
        paths: [path.join(workspaceRoot, "outside.pdf")],
      }),
      /uploads 目录之外/,
    );
  });
});
