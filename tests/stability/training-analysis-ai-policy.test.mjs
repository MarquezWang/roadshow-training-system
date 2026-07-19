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

const aiStubUrl = transpileToDataUrl(`
  export class AIEmptyContentError extends Error {
    constructor(message, details) {
      super(message);
      this.name = "AIEmptyContentError";
      this.task = details.task;
      this.model = details.model;
      this.responseFormat = details.responseFormat;
      this.finishReason = details.finishReason;
    }
  }
  export class AIResourceLimitError extends Error {}
  export async function callAI() { throw new Error("unexpected default AI call"); }
`);
const devLogStubUrl = transpileToDataUrl(`
  export function devError() {}
  export function devLog() {}
  export function devWarn() {}
`);
const diagnosticStubUrl = transpileToDataUrl(
  "export async function writeDiagnosticEvent() {}",
);
const fallbackBuilderStubUrl = transpileToDataUrl(`
  export function buildFallbackTrainingAnalysis() {
    throw new Error("unexpected default fallback call");
  }
`);
const validatorStubUrl = transpileToDataUrl(
  "export function validateTrainingAnalysisResult(value) { return value; }",
);
const contractStubUrl = transpileToDataUrl(`
  export const TRAINING_ANALYSIS_GENERATION_CONTRACT = {
    maxOutputTokens: 12000,
    repairMaxOutputTokens: 16000,
  };
`);
const jsonUtilsUrl = transpileToDataUrl(
  await readSource("../../lib/json-utils.ts"),
);
const promptRendererUrl = transpileToDataUrl(
  await readSource("../../lib/prompt-renderer.ts"),
);
const debugSource = (await readSource("../../lib/training-analysis-ai/debug.ts"))
  .replace('from "@/lib/ai"', `from "${aiStubUrl}"`)
  .replace('from "@/lib/json-utils"', `from "${jsonUtilsUrl}"`);
const debugUrl = transpileToDataUrl(debugSource);
const debug = await import(debugUrl);
const ai = await import(aiStubUrl);
const jsonUtils = await import(jsonUtilsUrl);
const promptsSource = (
  await readSource("../../lib/training-analysis-ai/prompts.ts")
)
  .replace(
    'from "@/lib/prompt-renderer"',
    `from "${promptRendererUrl}"`,
  )
  .replace('from "./debug"', `from "${debugUrl}"`);
const promptsUrl = transpileToDataUrl(promptsSource);
const prompts = await import(promptsUrl);
const storage = await import(
  transpileToDataUrl(
    await readSource("../../lib/training-analysis-ai/storage.ts"),
  ),
);
const parserSource = (
  await readSource("../../lib/training-analysis-ai/parser.ts")
)
  .replace('from "@/lib/ai"', `from "${aiStubUrl}"`)
  .replace('from "@/lib/ai-resource-guard"', `from "${aiStubUrl}"`)
  .replace('from "@/lib/dev-log"', `from "${devLogStubUrl}"`)
  .replace(
    'from "@/lib/diagnostic-log"',
    `from "${diagnosticStubUrl}"`,
  )
  .replace('from "@/lib/json-utils"', `from "${jsonUtilsUrl}"`)
  .replace(
    'from "@/lib/training-analysis-validator"',
    `from "${validatorStubUrl}"`,
  )
  .replace('from "./contract"', `from "${contractStubUrl}"`)
  .replace('from "./debug"', `from "${debugUrl}"`)
  .replace('from "./prompts"', `from "${promptsUrl}"`);
const parserUrl = transpileToDataUrl(parserSource);
const parser = await import(parserUrl);
const generationSource = (
  await readSource("../../lib/training-analysis-ai/generation.ts")
)
  .replace('from "@/lib/ai"', `from "${aiStubUrl}"`)
  .replace('from "@/lib/dev-log"', `from "${devLogStubUrl}"`)
  .replace(
    'from "@/lib/diagnostic-log"',
    `from "${diagnosticStubUrl}"`,
  )
  .replace(
    'from "@/lib/training-analysis-fallback-builder"',
    `from "${fallbackBuilderStubUrl}"`,
  )
  .replace('from "./contract"', `from "${contractStubUrl}"`)
  .replace('from "./debug"', `from "${debugUrl}"`)
  .replace('from "./parser"', `from "${parserUrl}"`);
const generation = await import(transpileToDataUrl(generationSource));

function emptyContentError(responseFormat, finishReason) {
  return new ai.AIEmptyContentError("AI 返回内容为空。", {
    task: "pitchAnalysis",
    model: "test-model",
    responseFormat,
    finishReason,
  });
}

function generationInput() {
  return {
    sessionId: "session-1",
    userId: "user-1",
    projectId: "project-1",
    userPrompt: "analyze this pitch",
    durationSec: 540,
    pageCount: 12,
    slideEventCount: 8,
    transcriptMissing: false,
    qaData: [],
    dynamicFollowupData: null,
  };
}

function analysisResult(label = "analysis") {
  return {
    label,
    overallScore: 80,
    summary: label,
    strengths: [],
    weaknesses: [],
    suggestions: [],
    contentCoverage: [],
    timing: {},
    slideSync: {},
    riskQuestions: [],
    qaReviews: [],
    dynamicFollowupReview: null,
  };
}

test("analysis prompt limits corpus samples and strips unused file fields", () => {
  const context = {
    project: { id: "project-1" },
    files: [
      {
        id: "file-1",
        originalName: "pitch.pdf",
        fileType: "application/pdf",
        includeInAIContext: true,
        extractedText: "pitch text",
        truncated: false,
        ignored: "not rendered",
      },
    ],
    evaluationRule: null,
    criteria: [],
    expertComments: Array.from({ length: 12 }, (_, index) => ({ id: index })),
    historicalQuestions: Array.from({ length: 12 }, (_, index) => ({
      id: index,
    })),
  };
  const input = {
    session: { id: "session-1" },
    slideEvents: [],
    transcript: { text: "transcript" },
    qaData: [],
    dynamicFollowupData: null,
  };

  assert.equal(
    JSON.parse(
      prompts.buildTrainingAnalysisPrompt(context, "{{expertComments}}", input),
    ).length,
    10,
  );
  assert.equal(
    JSON.parse(
      prompts.buildTrainingAnalysisPrompt(
        context,
        "{{historicalQuestions}}",
        input,
      ),
    ).length,
    10,
  );
  assert.deepEqual(
    JSON.parse(
      prompts
        .buildTrainingAnalysisPrompt(context, "{{files}}", input)
        .match(/<untrusted_data[^>]*>\n([\s\S]*)\n<\/untrusted_data>/)?.[1] ??
        "null",
    ),
    [
      {
        id: "file-1",
        originalName: "pitch.pdf",
        fileType: "application/pdf",
        extractedText: "pitch text",
        truncated: false,
      },
    ],
  );
  assert.equal(
    prompts.buildTrainingAnalysisPrompt(context, "{{session.id}}", input),
    "session-1",
  );
});

test("repair prompt includes parse diagnostics, schema and original output", () => {
  const error = new jsonUtils.AIJsonParseError("broken json", {
    originalLength: 120,
    extractedLength: 80,
    parsePosition: 47,
  });
  const prompt = prompts.buildRepairPrompt('{"summary":', error);

  assert.match(prompt, /解析错误：broken json/);
  assert.match(prompt, /原始返回长度：120/);
  assert.match(prompt, /截取后长度：80/);
  assert.match(prompt, /解析失败位置：47/);
  assert.match(prompt, /"dynamicFollowupReview": null/);
  assert.match(prompt, /需要修复的原始返回：\n<untrusted_data[^>]*>\n"\{\\"summary\\"/);
});

test("parse failure debug preserves metadata and bounds raw AI output", () => {
  const initialError = new jsonUtils.AIJsonParseError("initial", {
    originalLength: 4_100,
    extractedLength: 3_900,
    parsePosition: 42,
  });
  const debugValue = debug.buildAnalysisParseFailureDebug(
    {
      rawText: "x".repeat(4_100),
      initialError,
      repairError: new Error("repair failed"),
      jsonModeEmptyContent: {
        message: "empty",
        responseFormat: "json_object",
        finishReason: "length",
      },
    },
    new Date("2026-07-18T01:02:03.000Z"),
  );

  assert.equal(debugValue.generatedAt, "2026-07-18T01:02:03.000Z");
  assert.equal(debugValue.rawAiOutputLength, 4_100);
  assert.equal(debugValue.rawAiOutput.length, 4_014);
  assert.match(debugValue.rawAiOutput, /\.\.\.\[truncated\]$/);
  assert.deepEqual(debugValue.initialParseError, {
    message: "initial",
    originalLength: 4_100,
    extractedLength: 3_900,
    parsePosition: 42,
  });
  assert.equal(debugValue.repairError.message, "repair failed");
  assert.equal(debugValue.jsonModeEmptyContent.finishReason, "length");
});

test("empty-content debug records both JSON-mode and plain retry failures", () => {
  const first = emptyContentError("json_object", "length");
  const second = emptyContentError(null, "stop");
  const debugValue = debug.buildAnalysisEmptyContentDebug(
    {
      error: second,
      jsonModeEmptyContent: debug.getEmptyContentDetails(first),
    },
    new Date("2026-07-18T02:00:00.000Z"),
  );

  assert.equal(debugValue.reason, "AI_EMPTY_CONTENT");
  assert.equal(debugValue.generatedAt, "2026-07-18T02:00:00.000Z");
  assert.equal(debugValue.jsonModeEmptyContent.responseFormat, "json_object");
  assert.deepEqual(debugValue.retryWithoutJsonMode, {
    attempted: true,
    rawAiOutputLength: 0,
    rawAiOutput: "",
    emptyContent: true,
    finishReason: "stop",
  });
});

test("stored analysis only adds _debug for fallback diagnostics", () => {
  const analysis = analysisResult();
  assert.deepEqual(JSON.parse(storage.buildStoredTrainingAnalysisResult(analysis, null)), analysis);

  const debugValue = { reason: "AI_EMPTY_CONTENT", generatedAt: "now" };
  assert.deepEqual(
    JSON.parse(storage.buildStoredTrainingAnalysisResult(analysis, debugValue)),
    { ...analysis, _debug: debugValue },
  );
});

test("analysis parser returns valid initial JSON without repair", async () => {
  let repairCalls = 0;
  const expected = analysisResult("initial");
  const result = await parser.parseAnalysisJsonWithRepair(
    "valid",
    {
      sessionId: "session-1",
      userId: "user-1",
      projectId: "project-1",
    },
    {
      callAI: async () => {
        repairCalls += 1;
        return { text: "unexpected" };
      },
      parseAIJson: (text) => ({ text }),
      validateTrainingAnalysisResult: () => expected,
      writeDiagnosticEvent: async () => {},
      now: () => new Date("2026-07-18T03:00:00.000Z"),
    },
  );

  assert.equal(result, expected);
  assert.equal(repairCalls, 0);
});

test("analysis parser performs one schema repair with the frozen contract", async () => {
  const calls = [];
  const expected = analysisResult("repaired");
  const result = await parser.parseAnalysisJsonWithRepair(
    "broken raw output",
    {
      sessionId: "session-1",
      userId: "user-1",
      projectId: "project-1",
    },
    {
      callAI: async (options) => {
        calls.push(options);
        return { text: "fixed" };
      },
      parseAIJson: (text) => {
        if (text === "broken raw output") throw new Error("initial invalid");
        return { fixed: true };
      },
      validateTrainingAnalysisResult: () => expected,
      writeDiagnosticEvent: async () => {},
      now: () => new Date("2026-07-18T03:00:00.000Z"),
    },
  );

  assert.equal(result, expected);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].task, "pitchAnalysis");
  assert.equal(calls[0].userId, "user-1");
  assert.equal(calls[0].projectId, "project-1");
  assert.equal(calls[0].temperature, 0);
  assert.equal(calls[0].maxOutputTokens, 16_000);
  assert.match(calls[0].userPrompt, /broken raw output/);
  assert.match(calls[0].userPrompt, /initial invalid/);
});

test("analysis repair preserves AI resource-limit errors", async () => {
  const limited = new ai.AIResourceLimitError("limited");

  await assert.rejects(
    parser.parseAnalysisJsonWithRepair(
      "broken raw output",
      {
        sessionId: "session-1",
        userId: "user-1",
        projectId: "project-1",
      },
      {
        callAI: async () => {
          throw limited;
        },
        parseAIJson: () => {
          throw new Error("initial invalid");
        },
        validateTrainingAnalysisResult: (value) => value,
        writeDiagnosticEvent: async () => {},
        now: () => new Date(),
      },
    ),
    (error) => error === limited,
  );
});

test("analysis parser exposes bounded diagnostics after repair failure", async () => {
  const events = [];
  const rawText = "r".repeat(4_100);
  const initialError = new jsonUtils.AIJsonParseError("initial invalid", {
    originalLength: 4_100,
    extractedLength: 4_000,
    parsePosition: 99,
  });
  const repairError = new jsonUtils.AIJsonParseError("repair invalid", {
    originalLength: 100,
    extractedLength: 90,
    parsePosition: 50,
  });

  await assert.rejects(
    () =>
      parser.parseAnalysisJsonWithRepair(
        rawText,
        { sessionId: "session-1" },
        {
          callAI: async () => ({ text: "still broken" }),
          parseAIJson: (text) => {
            if (text === rawText) throw initialError;
            throw repairError;
          },
          validateTrainingAnalysisResult: (value) => value,
          writeDiagnosticEvent: async (event) => events.push(event),
          now: () => new Date("2026-07-18T04:00:00.000Z"),
        },
      ),
    (error) => {
      assert.equal(error instanceof parser.AnalysisJsonRepairError, true);
      assert.equal(error.debug.generatedAt, "2026-07-18T04:00:00.000Z");
      assert.equal(error.debug.rawAiOutputLength, 4_100);
      assert.equal(error.debug.initialParseError.parsePosition, 99);
      assert.equal(error.debug.repairError.parsePosition, 50);
      return true;
    },
  );
  assert.equal(events.length, 1);
  assert.deepEqual(events[0].meta, {
    sessionId: "session-1",
    initialError: "initial invalid",
    repairError: "repair invalid",
    rawAiOutputLength: 4_100,
    initialParsePosition: 99,
    repairParsePosition: 50,
  });
});

test("analysis generation sends the frozen primary request and returns parsed output", async () => {
  const calls = [];
  const expected = analysisResult("primary");
  const contexts = [];
  const result = await generation.generateTrainingAnalysisFromAI(
    generationInput(),
    {
      callAI: async (options) => {
        calls.push(options);
        return { text: "primary-json" };
      },
      parseAnalysisJsonWithRepair: async (text, context) => {
        contexts.push({ text, context });
        return expected;
      },
      buildFallbackTrainingAnalysis: () => {
        throw new Error("unexpected fallback");
      },
      writeDiagnosticEvent: async () => {},
      now: () => new Date("2026-07-18T05:00:00.000Z"),
    },
  );

  assert.deepEqual(result, {
    analysis: expected,
    debug: null,
    fallbackReason: null,
  });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].userId, "user-1");
  assert.equal(calls[0].projectId, "project-1");
  assert.equal(calls[0].temperature, 0.2);
  assert.equal(calls[0].maxOutputTokens, 12_000);
  assert.equal(calls[0].disableJsonResponseFormat, undefined);
  assert.deepEqual(contexts[0], {
    text: "primary-json",
    context: {
      sessionId: "session-1",
      userId: "user-1",
      projectId: "project-1",
      jsonModeEmptyContent: null,
      retryWithoutJsonMode: null,
    },
  });
});

test("JSON-mode empty content retries once without response_format", async () => {
  const calls = [];
  const events = [];
  const contexts = [];
  const expected = analysisResult("plain-retry");
  const retryText = "j".repeat(4_100);
  const result = await generation.generateTrainingAnalysisFromAI(
    generationInput(),
    {
      callAI: async (options) => {
        calls.push(options);
        if (calls.length === 1) {
          throw emptyContentError("json_object", "length");
        }
        return { text: retryText };
      },
      parseAnalysisJsonWithRepair: async (text, context) => {
        contexts.push({ text, context });
        return expected;
      },
      buildFallbackTrainingAnalysis: () => {
        throw new Error("unexpected fallback");
      },
      writeDiagnosticEvent: async (event) => events.push(event),
      now: () => new Date("2026-07-18T06:00:00.000Z"),
    },
  );

  assert.equal(result.analysis, expected);
  assert.equal(result.fallbackReason, null);
  assert.equal(calls.length, 2);
  assert.equal(calls[1].disableJsonResponseFormat, true);
  assert.equal(events.length, 1);
  assert.equal(contexts[0].context.jsonModeEmptyContent.responseFormat, "json_object");
  assert.equal(contexts[0].context.retryWithoutJsonMode.rawAiOutputLength, 4_100);
  assert.equal(contexts[0].context.retryWithoutJsonMode.rawAiOutput.length, 4_014);
});

test("two empty AI responses produce explicit fallback diagnostics", async () => {
  let callCount = 0;
  const fallbackInputs = [];
  const events = [];
  const fallback = analysisResult("empty-fallback");
  const result = await generation.generateTrainingAnalysisFromAI(
    generationInput(),
    {
      callAI: async () => {
        callCount += 1;
        throw callCount === 1
          ? emptyContentError("json_object", "length")
          : emptyContentError(null, "stop");
      },
      parseAnalysisJsonWithRepair: async () => {
        throw new Error("unexpected parser call");
      },
      buildFallbackTrainingAnalysis: (input) => {
        fallbackInputs.push(input);
        return fallback;
      },
      writeDiagnosticEvent: async (event) => events.push(event),
      now: () => new Date("2026-07-18T07:00:00.000Z"),
    },
  );

  assert.equal(callCount, 2);
  assert.equal(result.analysis, fallback);
  assert.equal(result.fallbackReason, "AI_EMPTY_CONTENT");
  assert.equal(result.debug.reason, "AI_EMPTY_CONTENT");
  assert.equal(result.debug.generatedAt, "2026-07-18T07:00:00.000Z");
  assert.equal(result.debug.jsonModeEmptyContent.finishReason, "length");
  assert.equal(result.debug.retryWithoutJsonMode.finishReason, "stop");
  assert.equal(fallbackInputs[0].failureReason, "AI_EMPTY_CONTENT");
  assert.equal(events.length, 2);
});

test("non-empty AI call failures still propagate without fallback", async () => {
  await assert.rejects(
    () =>
      generation.generateTrainingAnalysisFromAI(generationInput(), {
        callAI: async () => {
          throw new Error("network failure");
        },
        parseAnalysisJsonWithRepair: async () => analysisResult(),
        buildFallbackTrainingAnalysis: () => {
          throw new Error("unexpected fallback");
        },
        writeDiagnosticEvent: async () => {},
        now: () => new Date(),
      }),
    /network failure/,
  );
});

test("structured-output repair failures retain debug data in fallback", async () => {
  const fallback = analysisResult("parse-fallback");
  const debugValue = {
    reason: "AI_STRUCTURED_OUTPUT_INVALID",
    finalFallbackReason: "STRUCTURED_OUTPUT_INVALID_AFTER_REPAIR",
    generatedAt: "2026-07-18T08:00:00.000Z",
    rawAiOutputLength: 20,
    rawAiOutput: "broken",
  };
  const fallbackInputs = [];
  const result = await generation.generateTrainingAnalysisFromAI(
    generationInput(),
    {
      callAI: async () => ({ text: "broken" }),
      parseAnalysisJsonWithRepair: async () => {
        throw new parser.AnalysisJsonRepairError("repair failed", debugValue);
      },
      buildFallbackTrainingAnalysis: (input) => {
        fallbackInputs.push(input);
        return fallback;
      },
      writeDiagnosticEvent: async () => {},
      now: () => new Date(),
    },
  );

  assert.equal(result.analysis, fallback);
  assert.equal(result.debug, debugValue);
  assert.equal(result.fallbackReason, "STRUCTURED_OUTPUT_INVALID");
  assert.equal(fallbackInputs[0].failureReason, "STRUCTURED_OUTPUT_INVALID");
});
