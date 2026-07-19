import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";

async function importTsModule(relativePath) {
  const source = await readFile(new URL(relativePath, import.meta.url), "utf8");
  const output = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.ESNext,
      target: ts.ScriptTarget.ES2022,
    },
  }).outputText;
  return import(
    `data:text/javascript;base64,${Buffer.from(output).toString("base64")}`
  );
}

const { resolveQaDurationSec } = await importTsModule("../../lib/qa-duration.ts");

test("QA duration always prefers server timestamps", () => {
  const endedAt = new Date("2026-07-19T00:02:00.000Z");
  const startedAt = new Date("2026-07-19T00:00:00.000Z");

  assert.equal(resolveQaDurationSec(startedAt, endedAt, 7_000), 120);
  assert.equal(resolveQaDurationSec(null, endedAt, 90), 90);
  assert.equal(resolveQaDurationSec(null, endedAt, 7_201), null);
  assert.equal(resolveQaDurationSec(null, endedAt, -1), null);
});

test("new project flow references a server material token instead of resending content", async () => {
  const wizard = await readFile(
    new URL("../../components/new-project-wizard.tsx", import.meta.url),
    "utf8",
  );
  const createPage = await readFile(
    new URL("../../app/projects/new/page.tsx", import.meta.url),
    "utf8",
  );
  const profileRoute = await readFile(
    new URL("../../app/api/projects/profile-recognition/route.ts", import.meta.url),
    "utf8",
  );
  const materialRoute = await readFile(
    new URL("../../app/api/projects/material-parse/route.ts", import.meta.url),
    "utf8",
  );
  const staging = await readFile(
    new URL("../../lib/project-material-staging.ts", import.meta.url),
    "utf8",
  );

  assert.match(wizard, /JSON\.stringify\(\{ materialToken: token, mode \}\)/);
  assert.doesNotMatch(wizard, /name="materials"/);
  assert.match(wizard, /request\.send\(file\)/);
  assert.match(createPage, /reserveProjectMaterial\(materialToken/);
  assert.doesNotMatch(createPage, /parseFileToText|saveProjectUpload/);
  assert.match(profileRoute, /findAvailableProjectMaterial/);
  assert.doesNotMatch(profileRoute, /body\.extractedText/);
  assert.match(materialRoute, /request\.body/);
  assert.doesNotMatch(materialRoute, /request\.formData\(\)/);
  assert.match(staging, /streamWebBodyToFile/);
  assert.doesNotMatch(staging, /arrayBuffer\(\)/);
});

test("second-review concurrency and attribution boundaries are wired into production paths", async () => {
  const [
    staging,
    worker,
    executor,
    ai,
    answerRoute,
    answerStartRoute,
  ] = await Promise.all([
    readFile(new URL("../../lib/project-material-staging.ts", import.meta.url), "utf8"),
    readFile(new URL("../../lib/training-analysis-worker.ts", import.meta.url), "utf8"),
    readFile(
      new URL(
        "../../app/training/[sessionId]/analysis/training-analysis-executor.ts",
        import.meta.url,
      ),
      "utf8",
    ),
    readFile(new URL("../../lib/ai.ts", import.meta.url), "utf8"),
    readFile(
      new URL(
        "../../app/training/[sessionId]/qa/questions/[questionId]/answer/route.ts",
        import.meta.url,
      ),
      "utf8",
    ),
    readFile(
      new URL(
        "../../app/training/[sessionId]/qa/questions/[questionId]/start/route.ts",
        import.meta.url,
      ),
      "utf8",
    ),
  ]);

  assert.ok(
    staging.indexOf("claimExpiredProjectMaterial") <
      staging.indexOf("await rm(absolutePath"),
  );
  assert.match(worker, /startTrainingAnalysisLeaseRenewal/);
  assert.match(executor, /userId:\s*session\.project\.ownerId/);
  assert.match(executor, /projectId:\s*session\.projectId/);
  assert.ok(
    ai.indexOf("const resources = await acquireAIResources") <
      ai.indexOf("const timeout = setTimeout"),
  );
  assert.doesNotMatch(answerRoute, /answerStartedAt/);
  assert.match(answerStartRoute, /startedAt:\s*now/);
});
