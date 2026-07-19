import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

async function read(relativePath) {
  return readFile(new URL(relativePath, import.meta.url), "utf8");
}

const [
  schema,
  migration,
  diagnosisRoute,
  scoringRoute,
  questionRoute,
  aiClient,
  sessionRoute,
  transcriptExecution,
] = await Promise.all([
  read("../../prisma/schema.prisma"),
  read(
    "../../prisma/migrations/20260719120000_unify_diagnosis_and_ai_provenance/migration.sql",
  ),
  read("../../app/api/projects/[id]/material-diagnosis/route.ts"),
  read("../../app/projects/[id]/scoring/route.ts"),
  read("../../app/projects/[id]/questions/generate/route.ts"),
  read("../../lib/ai.ts"),
  read("../../app/projects/[id]/training-sessions/route.ts"),
  read("../../lib/training-transcribe/execution.ts"),
]);

test("Diagnosis is retired after preserving legacy rows in MaterialDiagnosis", () => {
  assert.doesNotMatch(schema, /model Diagnosis\s*\{/);
  assert.match(migration, /FROM "Diagnosis";/);
  assert.match(migration, /DROP TABLE "Diagnosis";/);
  assert.match(migration, /json_object\(/);
  assert.match(questionRoute, /prisma\.materialDiagnosis\.findFirst/);
  assert.doesNotMatch(questionRoute, /prisma\.diagnosis/);
});

test("diagnosis and scoring persist the complete AI provenance contract", () => {
  for (const field of [
    "inputHash",
    "promptVersion",
    "schemaVersion",
    "modelVersion",
    "ruleVersion",
  ]) {
    assert.match(diagnosisRoute, new RegExp(`\\b${field}\\b`));
    assert.match(scoringRoute, new RegExp(`\\b${field}\\b`));
  }
  assert.match(aiClient, /model:\s*config\.model/);
  assert.match(scoringRoute, /calculateProjectContextHash\(latestContext\)/);
});

test("other persisted JSON payloads carry explicit schema versions", () => {
  assert.match(schema, /contextSchemaVersion\s+String/);
  assert.match(schema, /segmentsSchemaVersion\s+String/);
  assert.match(sessionRoute, /contextSchemaVersion:\s*PROJECT_CONTEXT_SCHEMA_VERSION/);
  assert.match(
    transcriptExecution,
    /segmentsSchemaVersion:\s*TRANSCRIPT_SEGMENTS_SCHEMA_VERSION/,
  );
});
