import { createHash, randomUUID } from "node:crypto";
import { lstat, mkdir, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";

function isInside(root, candidate) {
  const relative = path.relative(root, candidate);
  return relative !== "" && !relative.startsWith("..") && !path.isAbsolute(relative);
}

function resolveUploadEntry(workspaceRoot, candidate) {
  const uploadRoot = path.resolve(
    /* turbopackIgnore: true */ workspaceRoot,
    "uploads",
  );
  const absolutePath = path.isAbsolute(candidate)
    ? path.resolve(/* turbopackIgnore: true */ candidate)
    : path.resolve(/* turbopackIgnore: true */ workspaceRoot, candidate);
  if (!isInside(uploadRoot, absolutePath)) {
    throw new Error("拒绝处理 uploads 目录之外的路径。");
  }
  const trashRoot = path.join(uploadRoot, ".trash");
  if (absolutePath === trashRoot || isInside(trashRoot, absolutePath)) {
    throw new Error("拒绝重复暂存 .trash 目录中的路径。");
  }
  return { uploadRoot, trashRoot, absolutePath };
}

function removeNestedCandidates(candidates) {
  const sorted = [...new Set(candidates)].sort(
    (left, right) => left.length - right.length,
  );
  return sorted.filter(
    (candidate, index) =>
      !sorted
        .slice(0, index)
        .some((parent) => isInside(parent, candidate)),
  );
}

export async function stageUploadEntries({
  workspaceRoot,
  paths,
  operationId = randomUUID(),
}) {
  const resolvedWorkspace = path.resolve(
    /* turbopackIgnore: true */ workspaceRoot,
  );
  const resolved = paths
    .filter((value) => typeof value === "string" && value.trim() !== "")
    .map((candidate) => resolveUploadEntry(resolvedWorkspace, candidate));
  const uploadRoot = path.resolve(
    /* turbopackIgnore: true */ resolvedWorkspace,
    "uploads",
  );
  const trashRoot = path.join(uploadRoot, ".trash");
  const locksRoot = path.join(uploadRoot, ".locks");
  const operationRoot = path.join(
    trashRoot,
    operationId.replace(/[^a-zA-Z0-9_-]/g, "") || randomUUID(),
  );
  const candidates = removeNestedCandidates(
    resolved.map((entry) => entry.absolutePath),
  );
  const staged = [];
  const missing = [];
  const contended = [];
  const ownedLocks = [];
  let finalized = false;

  await Promise.all([
    mkdir(operationRoot, { recursive: true }),
    mkdir(locksRoot, { recursive: true }),
  ]);
  try {
    for (let index = 0; index < candidates.length; index += 1) {
      const source = candidates[index];
      const lockName = `${createHash("sha256")
        .update(source.toLowerCase())
        .digest("hex")}.delete.tmp`;
      const lockPath = path.join(locksRoot, lockName);
      try {
        await writeFile(lockPath, operationId, { flag: "wx" });
        ownedLocks.push(lockPath);
      } catch (error) {
        if (error && typeof error === "object" && error.code === "EEXIST") {
          contended.push(source);
          continue;
        }
        throw error;
      }
      const sourceStat = await lstat(source).catch(() => null);
      if (!sourceStat) {
        missing.push(source);
        await rm(lockPath, { force: true }).catch(() => undefined);
        ownedLocks.splice(ownedLocks.indexOf(lockPath), 1);
        continue;
      }
      const target = path.join(operationRoot, String(index));
      try {
        await rename(source, target);
      } catch (error) {
        if (error && typeof error === "object" && error.code === "ENOENT") {
          missing.push(source);
          await rm(lockPath, { force: true }).catch(() => undefined);
          ownedLocks.splice(ownedLocks.indexOf(lockPath), 1);
          continue;
        }
        throw error;
      }
      staged.push({ source, target });
    }
  } catch (error) {
    for (const item of staged.reverse()) {
      await mkdir(path.dirname(item.source), { recursive: true }).catch(
        () => undefined,
      );
      await rename(item.target, item.source).catch(() => undefined);
    }
    await rm(operationRoot, { recursive: true, force: true }).catch(
      () => undefined,
    );
    await Promise.all(
      ownedLocks.map((lockPath) =>
        rm(lockPath, { force: true }).catch(() => undefined),
      ),
    );
    throw error;
  }

  return {
    stagedCount: staged.length,
    missingCount: missing.length,
    contendedCount: contended.length,
    async rollback() {
      if (finalized) return false;
      finalized = true;
      let complete = true;
      for (const item of [...staged].reverse()) {
        try {
          await mkdir(path.dirname(item.source), { recursive: true });
          await rename(item.target, item.source);
        } catch {
          complete = false;
        }
      }
      await rm(operationRoot, { recursive: true, force: true }).catch(
        () => undefined,
      );
      await Promise.all(
        ownedLocks.map((lockPath) =>
          rm(lockPath, { force: true }).catch(() => undefined),
        ),
      );
      return complete;
    },
    async commit() {
      if (finalized) return false;
      finalized = true;
      try {
        await rm(operationRoot, { recursive: true, force: true });
        await Promise.all(
          ownedLocks.map((lockPath) => rm(lockPath, { force: true })),
        );
        return true;
      } catch {
        // A later maintenance pass will purge stale trash entries.
        return false;
      }
    },
  };
}
