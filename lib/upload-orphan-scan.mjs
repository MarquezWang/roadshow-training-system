import { readdir, rm, stat } from "node:fs/promises";
import path from "node:path";

export const DEFAULT_UPLOAD_RETENTION_MS = 24 * 60 * 60 * 1_000;

function isInside(root, candidate) {
  const relative = path.relative(root, candidate);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function reportPath(workspaceRoot, absolutePath) {
  return path.relative(workspaceRoot, absolutePath).replaceAll(path.sep, "/");
}

async function collectUploadEntries(uploadRoot) {
  const files = [];
  const attemptDirectories = [];
  const trashEntries = [];

  async function visit(directory, insideTrash = false) {
    const entries = await readdir(
      /* turbopackIgnore: true */ directory,
      { withFileTypes: true },
    ).catch(
      () => [],
    );
    for (const entry of entries) {
      const absolutePath = path.join(directory, entry.name);
      if (entry.name === ".gitkeep") continue;

      if (insideTrash) {
        const entryStat = await stat(
          /* turbopackIgnore: true */ absolutePath,
        ).catch(() => null);
        if (entryStat) trashEntries.push({ absolutePath, stat: entryStat });
        continue;
      }

      if (entry.name === ".trash" && entry.isDirectory()) {
        await visit(absolutePath, true);
        continue;
      }

      if (entry.isDirectory() && entry.name.startsWith(".attempt-")) {
        const entryStat = await stat(
          /* turbopackIgnore: true */ absolutePath,
        ).catch(() => null);
        if (entryStat) attemptDirectories.push({ absolutePath, stat: entryStat });
        continue;
      }

      if (entry.isDirectory()) {
        await visit(absolutePath);
        continue;
      }

      if (entry.isFile()) {
        const entryStat = await stat(
          /* turbopackIgnore: true */ absolutePath,
        ).catch(() => null);
        if (entryStat) files.push({ absolutePath, stat: entryStat });
      }
    }
  }

  await visit(uploadRoot);
  return { files, attemptDirectories, trashEntries };
}

export async function scanUploadTree({
  workspaceRoot,
  references,
  olderThanMs = DEFAULT_UPLOAD_RETENTION_MS,
  orphanOlderThanMs = olderThanMs,
  temporaryOlderThanMs = olderThanMs,
  attemptOlderThanMs = temporaryOlderThanMs,
  trashOlderThanMs = olderThanMs,
  nowMs = Date.now(),
  deleteStale = false,
}) {
  const resolvedWorkspace = path.resolve(
    /* turbopackIgnore: true */ workspaceRoot,
  );
  const uploadRoot = path.resolve(
    /* turbopackIgnore: true */ resolvedWorkspace,
    "uploads",
  );
  const orphanCutoffMs = nowMs - orphanOlderThanMs;
  const temporaryCutoffMs = nowMs - temporaryOlderThanMs;
  const attemptCutoffMs = nowMs - attemptOlderThanMs;
  const trashCutoffMs = nowMs - trashOlderThanMs;
  const referencedAbsolutePaths = new Set();
  const missingReferences = [];
  const unsafeReferences = [];

  for (const storedPath of new Set(references.filter(Boolean))) {
    const absolutePath = path.resolve(
      /* turbopackIgnore: true */ resolvedWorkspace,
      storedPath,
    );
    if (!isInside(uploadRoot, absolutePath)) {
      unsafeReferences.push(storedPath);
      continue;
    }
    referencedAbsolutePaths.add(absolutePath.toLowerCase());
    const entryStat = await stat(
      /* turbopackIgnore: true */ absolutePath,
    ).catch(() => null);
    if (!entryStat?.isFile()) missingReferences.push(storedPath);
  }

  const entries = await collectUploadEntries(uploadRoot);
  const staleTemporaryFiles = [];
  const orphanFiles = [];
  const recentUnreferencedFiles = [];

  for (const entry of entries.files) {
    const relativePath = reportPath(resolvedWorkspace, entry.absolutePath);
    if (entry.absolutePath.toLowerCase().endsWith(".tmp")) {
      if (entry.stat.mtimeMs <= temporaryCutoffMs) {
        staleTemporaryFiles.push(relativePath);
      }
      continue;
    }

    if (!referencedAbsolutePaths.has(entry.absolutePath.toLowerCase())) {
      if (entry.stat.mtimeMs <= orphanCutoffMs) orphanFiles.push(relativePath);
      else recentUnreferencedFiles.push(relativePath);
    }
  }

  const staleAttemptDirectories = entries.attemptDirectories
    .filter((entry) => entry.stat.mtimeMs <= attemptCutoffMs)
    .map((entry) => reportPath(resolvedWorkspace, entry.absolutePath));
  const staleTrashEntries = entries.trashEntries
    .filter((entry) => entry.stat.mtimeMs <= trashCutoffMs)
    .map((entry) => reportPath(resolvedWorkspace, entry.absolutePath));

  const deletionCandidates = [
    ...orphanFiles,
    ...staleTemporaryFiles,
    ...staleAttemptDirectories,
    ...staleTrashEntries,
  ];
  const deleted = [];
  if (deleteStale) {
    for (const relativePath of deletionCandidates) {
      const absolutePath = path.resolve(
        /* turbopackIgnore: true */ resolvedWorkspace,
        relativePath,
      );
      if (!isInside(uploadRoot, absolutePath) || absolutePath === uploadRoot) {
        throw new Error(`拒绝删除 uploads 目录之外的路径：${relativePath}`);
      }
      await rm(/* turbopackIgnore: true */ absolutePath, {
        recursive: true,
        force: true,
      });
      deleted.push(relativePath);
    }
  }

  return {
    mode: deleteStale ? "delete-stale" : "read-only",
    olderThanHours: olderThanMs / 3_600_000,
    retentionHours: {
      orphan: orphanOlderThanMs / 3_600_000,
      temporary: temporaryOlderThanMs / 3_600_000,
      attempt: attemptOlderThanMs / 3_600_000,
      trash: trashOlderThanMs / 3_600_000,
    },
    referencedFileCount: referencedAbsolutePaths.size,
    missingReferences: missingReferences.sort(),
    unsafeReferences: unsafeReferences.sort(),
    orphanFiles: orphanFiles.sort(),
    recentUnreferencedFiles: recentUnreferencedFiles.sort(),
    staleTemporaryFiles: staleTemporaryFiles.sort(),
    staleAttemptDirectories: staleAttemptDirectories.sort(),
    staleTrashEntries: staleTrashEntries.sort(),
    deleted: deleted.sort(),
  };
}
