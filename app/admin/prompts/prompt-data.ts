import "server-only";

import { readdir, readFile, stat } from "fs/promises";
import path from "path";
import { getPromptAsset } from "./prompt-assets";
import { getChangelogItems } from "./prompt-policy";
import type { PromptRow, PromptTestSuite } from "./prompt-types";

const PROMPTS_DIR = path.resolve(process.cwd(), "prompts");
const PROMPT_TESTS_DIR = path.resolve(process.cwd(), "prompt-tests");
const MANAGEMENT_FILES = new Set(["README.md", "registry.md", "changelog.md"]);

export async function loadPromptRows(): Promise<PromptRow[]> {
  const entries = await readdir(PROMPTS_DIR, { withFileTypes: true });
  const promptFiles = entries
    .filter(
      (entry) =>
        entry.isFile() &&
        entry.name.endsWith(".md") &&
        !MANAGEMENT_FILES.has(entry.name),
    )
    .map((entry) => entry.name)
    .sort((left, right) => left.localeCompare(right));

  return Promise.all(
    promptFiles.map(async (file) => {
      const filePath = path.join(PROMPTS_DIR, file);
      const fileStat = await stat(filePath);

      return {
        ...getPromptAsset(file),
        size: fileStat.size,
        updatedAt: fileStat.mtime,
      };
    }),
  );
}

export async function loadPromptTestSuites(): Promise<PromptTestSuite[]> {
  try {
    const entries = await readdir(PROMPT_TESTS_DIR, { withFileTypes: true });
    const directories = entries
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort((left, right) => left.localeCompare(right));

    return Promise.all(
      directories.map(async (directory) => {
        const suiteDir = path.join(PROMPT_TESTS_DIR, directory);
        const files = await readdir(suiteDir);
        return {
          name: directory,
          count: files.filter((file) => file.endsWith(".json")).length,
        };
      }),
    );
  } catch {
    return [];
  }
}

export async function loadPromptChangelogPreview(): Promise<string[]> {
  try {
    const changelog = await readFile(
      path.join(PROMPTS_DIR, "changelog.md"),
      "utf8",
    );
    return getChangelogItems(changelog);
  } catch {
    return [];
  }
}
