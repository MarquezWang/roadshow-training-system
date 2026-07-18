import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";

function transpileToDataUrl(source) {
  const output = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.ESNext,
      target: ts.ScriptTarget.ES2022,
    },
  }).outputText;

  return `data:text/javascript;base64,${Buffer.from(output).toString("base64")}`;
}

async function readSource(relativePath) {
  return readFile(new URL(relativePath, import.meta.url), "utf8");
}

const prismaStubUrl = transpileToDataUrl(`
  export const prisma = {
    trainingSession: {
      findUnique: async () => { throw new Error("unexpected default session query"); },
    },
    trainingAnalysis: {
      updateMany: async () => { throw new Error("unexpected default analysis update"); },
    },
  };
`);
const projectContextStubUrl = transpileToDataUrl(`
  export async function buildProjectAIContext() {
    throw new Error("unexpected default project context query");
  }
`);
const versionStubUrl = transpileToDataUrl(`
  export const TRAINING_ANALYSIS_INPUT_HASH_VERSION = "v3";
  export const TRAINING_ANALYSIS_LEGACY_VERSION = "legacy-unknown";
  export function getTrainingAnalysisGenerationContract() {
    throw new Error("unexpected default generation contract read");
  }
`);
const repositoryStubUrl = transpileToDataUrl(`
  export async function findTrainingAnalysisInputSession() {
    throw new Error("unexpected default session query");
  }
`);
const legacyChangesStubUrl = transpileToDataUrl(`
  export async function findLegacyInputChangesSince() {
    throw new Error("unexpected default legacy change query");
  }
`);

const hashUrl = transpileToDataUrl(
  await readSource("../../lib/training-analysis-input/hash.ts"),
);
const hash = await import(hashUrl);
const canonicalUrl = transpileToDataUrl(
  (await readSource("../../lib/training-analysis-input/canonical.ts")).replace(
    'from "./hash"',
    `from "${hashUrl}"`,
  ),
);
const canonical = await import(canonicalUrl);
const calculationUrl = transpileToDataUrl(
  (await readSource("../../lib/training-analysis-input/calculation.ts"))
    .replace(
      'from "@/lib/project-context"',
      `from "${projectContextStubUrl}"`,
    )
    .replace(
      'from "@/lib/training-analysis-version.mjs"',
      `from "${versionStubUrl}"`,
    )
    .replace('from "./canonical"', `from "${canonicalUrl}"`)
    .replace('from "./hash"', `from "${hashUrl}"`)
    .replace('from "./repository"', `from "${repositoryStubUrl}"`),
);
const calculation = await import(calculationUrl);
const reconciliationUrl = transpileToDataUrl(
  (await readSource("../../lib/training-analysis-input/reconciliation.ts"))
    .replace('from "@/lib/prisma"', `from "${prismaStubUrl}"`)
    .replace(
      'from "@/lib/training-analysis-version.mjs"',
      `from "${versionStubUrl}"`,
    )
    .replace('from "./calculation"', `from "${calculationUrl}"`)
    .replace(
      'from "./legacy-changes"',
      `from "${legacyChangesStubUrl}"`,
    ),
);
const reconciliation = await import(reconciliationUrl);

const date = (day) =>
  new Date(`2026-07-${String(day).padStart(2, "0")}T00:00:00.000Z`);

const session = {
  id: "session-1",
  status: "QA_ENDED",
  pitchStartedAt: date(1),
  pitchEndedAt: date(2),
  pitchDurationSec: 61,
  qaStartedAt: date(3),
  qaEndedAt: date(4),
  qaDurationSec: 62,
  currentPageIndex: 3,
  primaryFileId: "file-1",
  projectContextSnapshot: null,
  project: {
    id: "project-1",
    name: "Project",
    field: "AI",
    stage: "seed",
    summary: "summary",
    coreTechnology: "core",
    applicationScenario: "scenario",
    businessModel: "model",
    cooperationDemand: "demand",
    productForm: "product",
    trlBasis: "trl",
    teamInfo: "team",
    cooperationDemandDetail: "detail",
    needsConversionSupport: true,
    updatedAt: date(5),
    fileAssets: [
      {
        id: "file-1",
        originalName: "deck.pptx",
        fileType: "pptx",
        parseStatus: "SUCCESS",
        includeInAIContext: true,
        extractedText: "deck text",
        updatedAt: date(6),
      },
    ],
  },
  slideEvents: [
    {
      id: "slide-1",
      fileId: "file-1",
      pageIndex: 2,
      eventType: "PAGE_CHANGE",
      elapsedSec: 8,
      createdAt: date(7),
    },
  ],
  recordings: [
    {
      id: "recording-1",
      phase: "PITCH",
      durationSec: 61,
      startedAt: date(8),
      endedAt: date(9),
      updatedAt: date(10),
      transcript: {
        id: "transcript-1",
        status: "COMPLETED",
        source: "ASR",
        language: "zh-CN",
        text: "pitch",
        revision: 2,
        completedAt: date(11),
        updatedAt: date(12),
      },
    },
  ],
  trainingQuestions: [
    {
      id: "question-1",
      orderIndex: 1,
      questionText: "Why?",
      questionType: "RISK",
      source: "AI",
      basis: "basis",
      updatedAt: date(13),
      answer: {
        id: "answer-1",
        recordingId: "recording-1",
        answerText: "Because",
        revealedQuestionText: true,
        startedAt: date(14),
        endedAt: date(15),
        durationSec: 20,
        updatedAt: date(16),
      },
    },
  ],
};

const projectContext = {
  project: { id: "project-1" },
  files: [{ text: "deck text" }],
};
const generationContract = {
  promptVersion: "p",
  schemaVersion: "s",
  modelVersion: "m",
  ruleVersion: "r",
  temperature: 0.2,
  maxOutputTokens: 12_000,
  repairMaxOutputTokens: 16_000,
  responseFormat: "json_object",
};

const expectedLiveHashes = {
  current: "v3:9e4013a881d0ca31282d4ca52d4946faff61da7d280f3dca1c888a521130c9b2",
  previous: "v2:2882e2bf9092f1fafed1bcb0b6385f3bbedd1fbdae3b692f3f17f1bae69debd8",
  legacy: "e412af57a4b0e6ed7259ddce1fd88478c52c6ca67f8112225b22fde049249f42",
};
const expectedSnapshotHashes = {
  current: "v3:96d45dd189c545c22a95e9f70b562950c6dfc3010f74ab7beea8e31aea2782e1",
  previous: "v2:b11a83fe1fd5a07a37406c3926d7bc36e57f02ece8cafcbcc021e10b4fe72217",
  legacy: "9f5da0735d042e003164d21d0d7f5fc56b55089e4a9f63d39639e461d898a2b3",
};

function buildHashes(inputSession = session, contract = generationContract) {
  const contextHash = inputSession.projectContextSnapshot
    ? hash.sha256(inputSession.projectContextSnapshot)
    : hash.sha256(projectContext);
  return calculation.buildTrainingAnalysisInputHashes(
    inputSession,
    contextHash,
    contract,
  );
}

test("v1/v2/v3 live-context hashes remain byte-compatible", () => {
  assert.deepEqual(buildHashes(), expectedLiveHashes);
});

test("v1/v2/v3 snapshot hashes remain byte-compatible", () => {
  const snapshotSession = {
    ...session,
    projectContextSnapshot: "snapshot-json",
  };
  assert.deepEqual(buildHashes(snapshotSession), expectedSnapshotHashes);
});

test("canonical inputs retain the historical field projections", () => {
  const current = canonical.buildCurrentTrainingAnalysisInput(session);
  const legacy = canonical.buildLegacyTrainingAnalysisInput(session);
  assert.equal(current.projectContext.files[0].extractedText, "deck text");
  assert.equal("updatedAt" in current.projectContext.files[0], false);
  assert.equal(
    legacy.project.fileAssets[0].updatedAt.toISOString(),
    date(6).toISOString(),
  );
  assert.equal("extractedText" in legacy.project.fileAssets[0], false);
  assert.equal("updatedAt" in current.recordings[0], false);
  assert.equal("text" in legacy.recordings[0].transcript, false);

  const snapshotSession = {
    ...session,
    projectContextSnapshot: "snapshot-json",
  };
  const snapshotCurrent =
    canonical.buildCurrentTrainingAnalysisInput(snapshotSession);
  const snapshotLegacy =
    canonical.buildLegacyTrainingAnalysisInput(snapshotSession);
  assert.deepEqual(Object.keys(snapshotCurrent.projectContext), [
    "snapshotHash",
  ]);
  assert.equal(JSON.stringify(snapshotLegacy).includes('"project"'), false);
});

test("snapshot calculation bypasses live project-context construction", async () => {
  let projectContextCalls = 0;
  const snapshotSession = {
    ...session,
    projectContextSnapshot: "snapshot-json",
  };
  const result = await calculation.calculateInputHashes("session-1", {
    findSession: async () => snapshotSession,
    buildProjectContext: async () => {
      projectContextCalls += 1;
      return projectContext;
    },
    getGenerationContract: () => generationContract,
  });
  assert.deepEqual(result, expectedSnapshotHashes);
  assert.equal(projectContextCalls, 0);
});

test("live calculation returns null for a missing session and hashes project context once", async () => {
  assert.equal(
    await calculation.calculateInputHashes("missing", {
      findSession: async () => null,
      buildProjectContext: async () => projectContext,
      getGenerationContract: () => generationContract,
    }),
    null,
  );

  let projectContextCalls = 0;
  const result = await calculation.calculateInputHashes("session-1", {
    findSession: async () => session,
    buildProjectContext: async (projectId) => {
      projectContextCalls += 1;
      assert.equal(projectId, "project-1");
      return projectContext;
    },
    getGenerationContract: () => generationContract,
  });
  assert.deepEqual(result, expectedLiveHashes);
  assert.equal(projectContextCalls, 1);
});

test("generation-contract changes affect only the v3 hash", () => {
  const changed = buildHashes(session, {
    ...generationContract,
    modelVersion: "new-model",
  });
  assert.notEqual(changed.current, expectedLiveHashes.current);
  assert.equal(changed.previous, expectedLiveHashes.previous);
  assert.equal(changed.legacy, expectedLiveHashes.legacy);
});

const analysis = {
  id: "analysis-1",
  status: "COMPLETED",
  inputHash: expectedLiveHashes.current,
  updatedAt: date(17),
};

function createReconciliationDependencies({
  hashResults = [expectedLiveHashes],
  legacyChanges = [],
  updateCount = 1,
} = {}) {
  const calls = {
    calculateHashes: [],
    findLegacyChanges: [],
    updateAnalyses: [],
  };
  let hashIndex = 0;
  return {
    calls,
    dependencies: {
      calculateHashes: async (sessionId) => {
        calls.calculateHashes.push(sessionId);
        const result = hashResults[Math.min(hashIndex, hashResults.length - 1)];
        hashIndex += 1;
        return result;
      },
      findLegacyChanges: async (...args) => {
        calls.findLegacyChanges.push(args);
        return legacyChanges;
      },
      updateAnalyses: async (args) => {
        calls.updateAnalyses.push(args);
        return { count: updateCount };
      },
    },
  };
}

test("missing, incomplete, and current analyses require no mutation", async () => {
  for (const [record, hashResults, expectedHash] of [
    [analysis, [null], null],
    [{ ...analysis, status: "PROCESSING" }, [expectedLiveHashes], expectedLiveHashes.current],
    [analysis, [expectedLiveHashes], expectedLiveHashes.current],
  ]) {
    const harness = createReconciliationDependencies({ hashResults });
    const result =
      await reconciliation.reconcileTrainingAnalysisInputVersionWithDependencies(
        "session-1",
        record,
        harness.dependencies,
      );
    assert.deepEqual(result, {
      stale: false,
      reason: null,
      currentInputHash: expectedHash,
      backfilled: false,
    });
    assert.equal(harness.calls.updateAnalyses.length, 0);
  }
});

test("matching v1/v2 hashes upgrade through a compare-and-set write", async () => {
  for (const oldHash of [
    expectedLiveHashes.legacy,
    expectedLiveHashes.previous,
  ]) {
    const harness = createReconciliationDependencies();
    const result =
      await reconciliation.reconcileTrainingAnalysisInputVersionWithDependencies(
        "session-1",
        { ...analysis, inputHash: oldHash },
        harness.dependencies,
      );
    assert.deepEqual(result, {
      stale: false,
      reason: null,
      currentInputHash: expectedLiveHashes.current,
      backfilled: true,
    });
    assert.deepEqual(harness.calls.updateAnalyses, [
      {
        where: {
          id: "analysis-1",
          status: "COMPLETED",
          inputHash: oldHash,
        },
        data: {
          inputHash: expectedLiveHashes.current,
          promptVersion: "legacy-unknown",
          schemaVersion: "legacy-unknown",
          modelVersion: "legacy-unknown",
          ruleVersion: "legacy-unknown",
        },
      },
    ]);
  }
});

test("a differing non-empty hash is stale without querying legacy timestamps", async () => {
  const harness = createReconciliationDependencies();
  const result =
    await reconciliation.reconcileTrainingAnalysisInputVersionWithDependencies(
      "session-1",
      { ...analysis, inputHash: "v3:different" },
      harness.dependencies,
    );
  assert.deepEqual(result, {
    stale: true,
    reason: "analysis input hash differs from the current training input",
    currentInputHash: expectedLiveHashes.current,
    backfilled: false,
  });
  assert.equal(harness.calls.findLegacyChanges.length, 0);
  assert.equal(harness.calls.updateAnalyses.length, 0);
});

test("legacy timestamp changes preserve their ordered stale reason", async () => {
  const harness = createReconciliationDependencies({
    legacyChanges: ["session", "transcript", "answer"],
  });
  const result =
    await reconciliation.reconcileTrainingAnalysisInputVersionWithDependencies(
      "session-1",
      { ...analysis, inputHash: "" },
      harness.dependencies,
    );
  assert.deepEqual(result, {
    stale: true,
    reason: "legacy analysis inputs changed: session,transcript,answer",
    currentInputHash: expectedLiveHashes.current,
    backfilled: false,
  });
  assert.deepEqual(harness.calls.findLegacyChanges, [
    ["session-1", analysis.updatedAt],
  ]);
});

test("a concurrent input change aborts legacy backfill", async () => {
  for (const confirmedHashes of [
    null,
    { ...expectedLiveHashes, current: "v3:changed-during-upgrade" },
  ]) {
    const harness = createReconciliationDependencies({
      hashResults: [expectedLiveHashes, confirmedHashes],
    });
    const result =
      await reconciliation.reconcileTrainingAnalysisInputVersionWithDependencies(
        "session-1",
        { ...analysis, inputHash: "" },
        harness.dependencies,
      );
    assert.deepEqual(result, {
      stale: true,
      reason: "analysis input changed while upgrading legacy report",
      currentInputHash: confirmedHashes?.current ?? null,
      backfilled: false,
    });
    assert.equal(harness.calls.updateAnalyses.length, 0);
  }
});

test("unchanged legacy input is backfilled with a timestamp-guarded write", async () => {
  const harness = createReconciliationDependencies();
  const result =
    await reconciliation.reconcileTrainingAnalysisInputVersionWithDependencies(
      "session-1",
      { ...analysis, inputHash: "" },
      harness.dependencies,
    );
  assert.deepEqual(result, {
    stale: false,
    reason: null,
    currentInputHash: expectedLiveHashes.current,
    backfilled: true,
  });
  assert.deepEqual(harness.calls.calculateHashes, ["session-1", "session-1"]);
  assert.deepEqual(harness.calls.updateAnalyses, [
    {
      where: {
        id: "analysis-1",
        status: "COMPLETED",
        inputHash: "",
        updatedAt: analysis.updatedAt,
      },
      data: {
        inputHash: expectedLiveHashes.current,
        promptVersion: "legacy-unknown",
        schemaVersion: "legacy-unknown",
        modelVersion: "legacy-unknown",
        ruleVersion: "legacy-unknown",
      },
    },
  ]);
});
