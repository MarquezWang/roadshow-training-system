#!/usr/bin/env node

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import nextEnv from "@next/env";

const PROJECT_ROOT = process.cwd();
const DEFAULT_RUNS = 5;
const DEFAULT_MATERIAL_WEIGHT = 0.7;
const DEFAULT_PERFORMANCE_WEIGHT = 0.3;
const OUTPUT_DIR = path.join(PROJECT_ROOT, "tmp", "scoring-v2-stability");
const CONTEXT_EXPERT_COMMENT_LIMIT = 10;
const CONTEXT_HISTORICAL_QUESTION_LIMIT = 10;
const MAX_SINGLE_FILE_TEXT_LENGTH = 20_000;
const MAX_ALL_FILES_TEXT_LENGTH = 60_000;
const REAL_RULE_NAME = "路演大赛真实评审规则";
const DEFAULT_RULE_NAME = "路演大赛通用评审规则";
const { loadEnvConfig } = nextEnv;

function parseArgs(argv) {
  const args = {
    runs: DEFAULT_RUNS,
    projectId: "",
    sessionId: "",
    outDir: OUTPUT_DIR,
    listCandidates: false,
    printConfig: false,
    materialWeight: undefined,
    performanceWeight: undefined,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = argv[index + 1];

    if (arg === "--runs" && next) {
      args.runs = Number(next);
      index += 1;
    } else if (arg === "--project-id" && next) {
      args.projectId = next;
      index += 1;
    } else if (arg === "--session-id" && next) {
      args.sessionId = next;
      index += 1;
    } else if (arg === "--out-dir" && next) {
      args.outDir = path.resolve(PROJECT_ROOT, next);
      index += 1;
    } else if (arg === "--material-weight" && next) {
      args.materialWeight = Number(next);
      index += 1;
    } else if (arg === "--performance-weight" && next) {
      args.performanceWeight = Number(next);
      index += 1;
    } else if (arg === "--list-candidates") {
      args.listCandidates = true;
    } else if (arg === "--print-config") {
      args.printConfig = true;
    } else if (arg === "--help" || arg === "-h") {
      printUsage();
      process.exit(0);
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  if (!Number.isInteger(args.runs) || args.runs < 1 || args.runs > 20) {
    throw new Error("--runs must be an integer from 1 to 20.");
  }

  return args;
}

function printUsage() {
  console.log(`Usage:
  node scripts/measure-scoring-stability.mjs --session-id <id> [--runs 5]
  node scripts/measure-scoring-stability.mjs --project-id <id> --session-id <id> --runs 10
  node scripts/measure-scoring-stability.mjs --list-candidates
  node scripts/measure-scoring-stability.mjs --print-config

Options:
  --runs <n>                 Repeat count, 1-20. Default: 5.
  --project-id <id>          Fixed project material source. Defaults to the session project.
  --session-id <id>          Fixed pitch transcript and QA source.
  --material-weight <n>      Composite material weight. Default: 0.7.
  --performance-weight <n>   Composite performance weight. Default: 0.3.
  --out-dir <path>           Output directory. Default: tmp/scoring-v2-stability.
`);
}

function loadEnv() {
  const result = loadEnvConfig(PROJECT_ROOT);
  const loadedEnv = {};

  for (const file of [...result.loadedEnvFiles].reverse()) {
    Object.assign(loadedEnv, file.env);
  }

  for (const [key, value] of Object.entries(loadedEnv)) {
    if (!process.env[key]?.trim()) {
      process.env[key] = value;
    }
  }

  return process.env;
}

function getRequiredEnv(env, name) {
  const value = env[name]?.trim();
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

function sanitizeErrorMessage(error, env) {
  const message = error instanceof Error ? error.message : String(error);
  let sanitized = message
    .replace(/sk-[A-Za-z0-9_-]+/g, "[redacted]")
    .replace(/Bearer\s+[A-Za-z0-9._-]+/g, "Bearer [redacted]")
    .replace(/api key:\s*\S+/gi, "api key: [redacted]");

  for (const key of ["AI_API_KEY", "OPENAI_API_KEY"]) {
    const value = env[key]?.trim();
    if (value) sanitized = sanitized.split(value).join("[redacted]");
  }

  return sanitized;
}

function getStrongModel(env) {
  return (
    env.AI_MODEL_STRONG?.trim() ||
    env.AI_MODEL?.trim() ||
    "deepseek-v4-pro"
  );
}

function getFastModel(env) {
  return (
    env.AI_MODEL_FAST?.trim() ||
    env.AI_MODEL?.trim() ||
    "deepseek-v4-flash"
  );
}

function getModelConfig(env) {
  const configuredAiModel = env.AI_MODEL?.trim() || "";
  const configuredFastModel = env.AI_MODEL_FAST?.trim() || "";
  const configuredStrongModel = env.AI_MODEL_STRONG?.trim() || "";
  const actualStrongModel = getStrongModel(env);

  return {
    hasAIKey: Boolean(env.AI_API_KEY?.trim()),
    configuredAiModel,
    configuredFastModel,
    configuredStrongModel,
    actualScoringModel: actualStrongModel,
    actualPitchAnalysisModel: actualStrongModel,
    AI_PROVIDER: env.AI_PROVIDER?.trim() || "openai",
    hasAIBaseURL: Boolean(env.AI_BASE_URL?.trim()),
    resolvedFastModel: getFastModel(env),
  };
}

function hashText(text) {
  return crypto.createHash("sha256").update(text).digest("hex");
}

function renderPrompt(template, variables) {
  return template.replace(/\{\{\s*([a-zA-Z0-9_.-]+)\s*\}\}/g, (match, key) => {
    const value = key.split(".").reduce((current, part) => {
      if (
        current &&
        typeof current === "object" &&
        Object.prototype.hasOwnProperty.call(current, part)
      ) {
        return current[part];
      }
      return undefined;
    }, variables);

    if (value === undefined) return match;
    if (typeof value === "string") return value;
    if (value === null) return "";
    return JSON.stringify(value, null, 2);
  });
}

function findBalancedJsonEnd(text, start) {
  const opening = text[start];
  const stack = [opening === "{" ? "}" : "]"];
  let inString = false;
  let escaped = false;

  for (let index = start + 1; index < text.length; index += 1) {
    const character = text[index];

    if (inString) {
      if (escaped) escaped = false;
      else if (character === "\\") escaped = true;
      else if (character === '"') inString = false;
      continue;
    }

    if (character === '"') inString = true;
    else if (character === "{") stack.push("}");
    else if (character === "[") stack.push("]");
    else if (character === "}" || character === "]") {
      if (stack.at(-1) !== character) return null;
      stack.pop();
      if (stack.length === 0) return index;
    }
  }

  return null;
}

function parseAIJson(text) {
  const trimmed = text.trim();
  const candidates = [trimmed];

  for (let index = 0; index < trimmed.length; index += 1) {
    if (trimmed[index] !== "{" && trimmed[index] !== "[") continue;
    const end = findBalancedJsonEnd(trimmed, index);
    if (end !== null) candidates.push(trimmed.slice(index, end + 1).trim());
  }

  let lastError = null;
  for (const candidate of [...new Set(candidates.filter(Boolean))]) {
    try {
      return JSON.parse(candidate);
    } catch (error) {
      lastError = error;
    }
  }

  throw lastError ?? new Error("AI output was empty.");
}

function takeFileTexts(files) {
  let remaining = MAX_ALL_FILES_TEXT_LENGTH;
  let filesTruncated = false;
  let allFilesTextTruncated = false;
  const result = [];

  for (const file of files) {
    if (!file.extractedText || remaining <= 0) {
      allFilesTextTruncated = true;
      continue;
    }

    const singleFileText = file.extractedText.slice(
      0,
      MAX_SINGLE_FILE_TEXT_LENGTH,
    );
    const text = singleFileText.slice(0, remaining);
    const truncated =
      file.extractedText.length > MAX_SINGLE_FILE_TEXT_LENGTH ||
      singleFileText.length > remaining;

    remaining -= text.length;
    filesTruncated = filesTruncated || truncated;
    allFilesTextTruncated = allFilesTextTruncated || remaining <= 0;
    result.push({
      id: file.id,
      originalName: file.originalName,
      fileType: file.fileType,
      includeInAIContext: file.includeInAIContext,
      extractedText: text,
      truncated,
    });
  }

  return {
    files: result,
    filesTruncated,
    allFilesTextTruncated,
  };
}

async function findEvaluationRule(prisma) {
  return (
    (await prisma.evaluationRule.findFirst({
      where: { name: REAL_RULE_NAME },
      include: { criteria: { orderBy: { sortOrder: "asc" } } },
    })) ??
    (await prisma.evaluationRule.findFirst({
      where: { name: DEFAULT_RULE_NAME },
      include: { criteria: { orderBy: { sortOrder: "asc" } } },
    })) ??
    (await prisma.evaluationRule.findFirst({
      orderBy: { createdAt: "asc" },
      include: { criteria: { orderBy: { sortOrder: "asc" } } },
    }))
  );
}

async function buildProjectContext(prisma, projectId) {
  const project = await prisma.project.findUnique({
    where: { id: projectId },
    include: {
      fileAssets: {
        where: {
          parseStatus: "SUCCESS",
          includeInAIContext: true,
          extractedText: { not: null },
        },
        orderBy: { createdAt: "asc" },
        select: {
          id: true,
          originalName: true,
          fileType: true,
          includeInAIContext: true,
          extractedText: true,
        },
      },
    },
  });

  if (!project) throw new Error(`Project not found: ${projectId}`);

  const [rule, expertComments, historicalQuestions] = await Promise.all([
    findEvaluationRule(prisma),
    prisma.expertComment.findMany({
      orderBy: { createdAt: "desc" },
      take: 20,
    }),
    prisma.historicalQuestion.findMany({
      orderBy: { createdAt: "asc" },
      take: 20,
    }),
  ]);
  const fileTextResult = takeFileTexts(project.fileAssets);

  if (!rule) throw new Error("No evaluation rule found.");
  if (rule.criteria.length === 0) {
    throw new Error("Evaluation rule has no criteria.");
  }
  if (fileTextResult.files.length === 0) {
    throw new Error(`Project ${projectId} has no analysable files.`);
  }

  return {
    project: {
      id: project.id,
      name: project.name,
      field: project.field,
      stage: project.stage,
      summary: project.summary,
      coreTechnology: project.coreTechnology,
      applicationScenario: project.applicationScenario,
      businessModel: project.businessModel,
      cooperationDemand: project.cooperationDemand,
    },
    files: fileTextResult.files,
    evaluationRule: {
      id: rule.id,
      name: rule.name,
      contestName: rule.contestName,
      version: rule.version,
      totalScore: rule.totalScore,
      description: rule.description,
      rawText: rule.rawText,
    },
    criteria: rule.criteria.map((criterion) => ({
      id: criterion.id,
      category: criterion.category,
      name: criterion.name,
      weight: criterion.weight,
      description: criterion.description,
      scoringGuide: criterion.scoringGuide,
      sortOrder: criterion.sortOrder,
    })),
    expertComments: expertComments
      .slice(0, CONTEXT_EXPERT_COMMENT_LIMIT)
      .map((item) => ({
        id: item.id,
        contestName: item.contestName,
        projectField: item.projectField,
        dimension: item.dimension,
        commentText: item.commentText,
        problemType: item.problemType,
        suggestionType: item.suggestionType,
        scoreRange: item.scoreRange,
      })),
    historicalQuestions: historicalQuestions
      .slice(0, CONTEXT_HISTORICAL_QUESTION_LIMIT)
      .map((item) => ({
        id: item.id,
        contestName: item.contestName,
        projectField: item.projectField,
        perspective: item.perspective,
        questionText: item.questionText,
        focus: item.focus,
      })),
    truncated: {
      files: fileTextResult.filesTruncated,
      allFilesText: fileTextResult.allFilesTextTruncated,
    },
  };
}

function isDynamicFollowupQuestion(question) {
  return (
    question.source === "DYNAMIC_FOLLOWUP" || question.questionType === "FOLLOWUP"
  );
}

function hasEnteredAnswer(answer) {
  return Boolean(
    answer?.startedAt ||
      answer?.endedAt ||
      answer?.recording ||
      answer?.answerText?.trim(),
  );
}

function mapQuestionToAnalysisData(question) {
  const transcribeStatus = question.answer?.recording?.transcript?.status ?? null;
  const transcribeText = question.answer?.recording?.transcript?.text ?? null;
  const transcribePending =
    transcribeStatus === "PENDING" || transcribeStatus === "PROCESSING";

  return {
    questionId: question.id,
    orderIndex: question.orderIndex,
    questionType: question.questionType,
    source: question.source,
    questionText: question.questionText,
    answerDurationSec: question.answer?.durationSec ?? null,
    answerText: question.answer?.answerText ?? null,
    transcribeText,
    transcribeStatus,
    transcribeFailed: transcribeStatus === "FAILED",
    transcribePending,
    transcribeNote:
      transcribeStatus === "FAILED"
        ? "该题转写失败，分析依据可能不足，请基于答题时长和项目材料进行有限分析。"
        : transcribePending
          ? "该题转写超时未完成，分析依据不足，请基于项目材料和答题时长进行有限分析。"
          : null,
  };
}

async function buildSessionInput(prisma, sessionId, projectId) {
  const session = await prisma.trainingSession.findUnique({
    where: { id: sessionId },
    include: {
      slideEvents: { orderBy: { elapsedSec: "asc" } },
      transcripts: {
        where: {
          status: "COMPLETED",
          text: { not: "" },
          recording: { phase: "PITCH" },
        },
        orderBy: { updatedAt: "desc" },
        take: 1,
      },
      trainingQuestions: {
        orderBy: { orderIndex: "asc" },
        include: {
          answer: {
            include: {
              recording: {
                include: {
                  transcript: true,
                },
              },
            },
          },
        },
      },
    },
  });

  if (!session) throw new Error(`Session not found: ${sessionId}`);
  if (session.projectId !== projectId) {
    throw new Error(
      `Session ${sessionId} belongs to project ${session.projectId}, not ${projectId}.`,
    );
  }

  const transcript = session.transcripts[0] ?? null;
  if (!transcript?.text?.trim()) {
    throw new Error(`Session ${sessionId} has no fixed pitch transcript.`);
  }

  const enteredQuestions = session.trainingQuestions.filter((question) =>
    hasEnteredAnswer(question.answer),
  );
  const baseEnteredQuestions = enteredQuestions.filter(
    (question) => !isDynamicFollowupQuestion(question),
  );
  if (baseEnteredQuestions.length === 0) {
    throw new Error(`Session ${sessionId} has no fixed QA answers.`);
  }

  const dynamicFollowupQuestion =
    enteredQuestions.find((question) => isDynamicFollowupQuestion(question)) ??
    null;
  const pageIndexes = session.slideEvents
    .map((event) => event.pageIndex)
    .filter((pageIndex) => pageIndex !== null);
  const pageCount =
    pageIndexes.length > 0 ? new Set(pageIndexes).size : null;
  const durationSec =
    session.pitchDurationSec ??
    (session.pitchEndedAt
      ? Math.round(
          (session.pitchEndedAt.getTime() -
            (session.pitchStartedAt?.getTime() ??
              session.pitchEndedAt.getTime())) /
            1000,
        )
      : 0);

  return {
    session: {
      id: session.id,
      status: session.status,
      pitchStartedAt: session.pitchStartedAt?.toISOString() ?? null,
      pitchEndedAt: session.pitchEndedAt?.toISOString() ?? null,
      pitchDurationSec: durationSec,
      currentPageIndex: session.currentPageIndex,
    },
    slideEvents: session.slideEvents.map((event) => ({
      eventType: event.eventType,
      pageIndex: event.pageIndex,
      elapsedSec: event.elapsedSec,
      createdAt: event.createdAt.toISOString(),
    })),
    transcript: {
      id: transcript.id,
      source: transcript.source,
      language: transcript.language,
      completedAt: transcript.completedAt?.toISOString() ?? null,
      text: transcript.text,
    },
    qaData: baseEnteredQuestions.map(mapQuestionToAnalysisData),
    dynamicFollowupData: dynamicFollowupQuestion
      ? mapQuestionToAnalysisData(dynamicFollowupQuestion)
      : null,
    durationSec,
    pageCount,
    slideEventCount: session.slideEvents.length,
  };
}

async function listCandidates(prisma) {
  const sessions = await prisma.trainingSession.findMany({
    orderBy: { updatedAt: "desc" },
    take: 20,
    select: {
      id: true,
      projectId: true,
      status: true,
      updatedAt: true,
      project: {
        select: {
          name: true,
          fileAssets: {
            where: {
              parseStatus: "SUCCESS",
              includeInAIContext: true,
              extractedText: { not: null },
            },
            select: { id: true },
          },
        },
      },
      transcripts: {
        where: {
          status: "COMPLETED",
          text: { not: "" },
          recording: { phase: "PITCH" },
        },
        select: { id: true, text: true },
        take: 1,
      },
      trainingQuestions: {
        select: {
          id: true,
          answer: {
            select: {
              answerText: true,
              recording: {
                select: {
                  transcript: {
                    select: {
                      text: true,
                      status: true,
                    },
                  },
                },
              },
            },
          },
        },
      },
    },
  });

  return sessions.map((session) => ({
    sessionId: session.id,
    projectId: session.projectId,
    projectName: session.project.name,
    status: session.status,
    aiFileCount: session.project.fileAssets.length,
    hasPitchTranscript: session.transcripts.some((item) => item.text?.trim()),
    questionCount: session.trainingQuestions.length,
    answeredQuestionCount: session.trainingQuestions.filter(
      (question) =>
        question.answer?.answerText?.trim() ||
        question.answer?.recording?.transcript?.text?.trim(),
    ).length,
    updatedAt: session.updatedAt.toISOString(),
  }));
}

async function autoSelectCandidate(prisma) {
  const candidates = await listCandidates(prisma);
  return candidates.find(
    (candidate) =>
      candidate.aiFileCount > 0 &&
      candidate.hasPitchTranscript &&
      candidate.answeredQuestionCount > 0,
  );
}

function buildScoringPrompt(context, template) {
  return renderPrompt(template, {
    project: context.project,
    files: context.files.map((file) => ({
      id: file.id,
      originalName: file.originalName,
      fileType: file.fileType,
      extractedText: file.extractedText,
      truncated: file.truncated,
    })),
    evaluationRule: context.evaluationRule,
    criteria: context.criteria,
    expertComments: context.expertComments,
    historicalQuestions: context.historicalQuestions,
  });
}

function buildAnalysisPrompt(context, template, sessionInput) {
  return renderPrompt(template, {
    session: sessionInput.session,
    slideEvents: sessionInput.slideEvents,
    transcript: sessionInput.transcript,
    qaData: sessionInput.qaData,
    dynamicFollowupData: sessionInput.dynamicFollowupData,
    project: context.project,
    files: context.files.map((file) => ({
      id: file.id,
      originalName: file.originalName,
      fileType: file.fileType,
      extractedText: file.extractedText,
      truncated: file.truncated,
    })),
    evaluationRule: context.evaluationRule,
    criteria: context.criteria,
    expertComments: context.expertComments,
    historicalQuestions: context.historicalQuestions,
  });
}

async function callAI({ env, model, systemPrompt, userPrompt, temperature }) {
  const { default: OpenAI } = await import("openai");
  const client = new OpenAI({
    apiKey: getRequiredEnv(env, "AI_API_KEY"),
    baseURL: env.AI_BASE_URL?.trim() || undefined,
  });
  const timeoutMs = Number(env.AI_TIMEOUT_MS) || 120_000;
  const maxTokens = Number(env.AI_MAX_OUTPUT_TOKENS) || 6_000;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  const startedAt = Date.now();

  try {
    const completion = await client.chat.completions.create(
      {
        model,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
        temperature,
        max_tokens: maxTokens,
      },
      { signal: controller.signal },
    );
    const text = completion.choices[0]?.message?.content?.trim();
    if (!text) {
      const error = new Error("AI returned empty content.");
      error.diagnosticStatus = "empty_result";
      throw error;
    }
    return {
      text,
      elapsedMs: Date.now() - startedAt,
    };
  } catch (error) {
    if (controller.signal.aborted) {
      error.diagnosticStatus = "timeout";
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

function readNumber(value) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function normalizeEvidenceStrength(value) {
  return value === "STRONG" || value === "PARTIAL" || value === "MISSING"
    ? value
    : null;
}

function normalizeRiskLevel(value) {
  return value === "LOW" ||
    value === "MEDIUM" ||
    value === "HIGH" ||
    value === "UNKNOWN"
    ? value
    : null;
}

function isBarrierCriterion(criterion) {
  return criterion === "进入壁垒";
}

function deriveMappedScore({ criterion, maxScore, evidenceStrength, riskLevel }) {
  const normalizedEvidenceStrength =
    normalizeEvidenceStrength(evidenceStrength) ?? "MISSING";
  const normalizedRiskLevel = normalizeRiskLevel(riskLevel) ?? "UNKNOWN";
  const evidenceStrengthBaseRatio = {
    MISSING: 0.1,
    PARTIAL: 0.45,
    STRONG: 0.8,
  };
  const riskLevelAdjustment = {
    HIGH: -0.2,
    MEDIUM: -0.1,
    UNKNOWN: -0.05,
    LOW: 0.05,
  };
  const ratio = Math.min(
    1,
    Math.max(
      0,
      evidenceStrengthBaseRatio[normalizedEvidenceStrength] +
        riskLevelAdjustment[normalizedRiskLevel],
    ),
  );
  let mappedScore = Math.round(maxScore * ratio);

  if (isBarrierCriterion(criterion)) {
    if (normalizedEvidenceStrength === "MISSING") {
      mappedScore = Math.min(mappedScore, 2);
    } else if (normalizedEvidenceStrength === "PARTIAL") {
      mappedScore = Math.min(mappedScore, 5);
    }
  }

  return {
    mappedScore,
    evidenceStrength: normalizedEvidenceStrength,
    riskLevel: normalizedRiskLevel,
  };
}

function makeDiagnosticError(status, message, paths = [], details = {}) {
  return {
    status,
    message,
    paths,
    details,
  };
}

function classifyError(error) {
  if (error?.diagnosticStatus) return error.diagnosticStatus;

  const name = typeof error?.name === "string" ? error.name : "";
  const message = error instanceof Error ? error.message : String(error);

  if (/timeout/i.test(message)) return "timeout";
  if (name === "AbortError") return "aborted";
  if (
    typeof error?.status === "number" ||
    /^\d{3}\s/.test(message) ||
    /API|Authentication|rate limit|quota|model/i.test(message)
  ) {
    return "api_error";
  }

  return "unknown_error";
}

function parseJsonForPhase(rawText) {
  try {
    return {
      status: "success",
      value: parseAIJson(rawText),
      error: null,
    };
  } catch (error) {
    return {
      status: "json_parse_failed",
      value: null,
      error: makeDiagnosticError(
        "json_parse_failed",
        error instanceof Error ? error.message : String(error),
      ),
    };
  }
}

function extractScoreMetrics(scoreJson) {
  const scoreItems = Array.isArray(scoreJson.scoreItems)
    ? scoreJson.scoreItems
        .map((item) => ({
          category: String(item.category ?? ""),
          criterion: String(item.criterion ?? ""),
          maxScore: readNumber(item.maxScore),
          aiSuggestedScore: readNumber(item.aiSuggestedScore ?? item.score),
          mappedScore: null,
          evidenceStrength: normalizeEvidenceStrength(item.evidenceStrength),
          riskLevel: normalizeRiskLevel(item.riskLevel),
          hasEvidenceText: Boolean(item.evidence?.evidenceText?.trim()),
          evidenceTextIndicatesMissing:
            typeof item.evidence?.evidenceText === "string" &&
            /材料未提供|未提供相关证据|未提及|未说明|无法判断|依据不足/.test(
              item.evidence.evidenceText,
            ),
        }))
    : [];
  const observedAiMaterialScore = scoreItems.every(
    (item) => item.aiSuggestedScore !== null,
  )
    ? scoreItems.reduce((sum, item) => sum + (item.aiSuggestedScore ?? 0), 0)
    : readNumber(scoreJson.totalScore);

  return {
    observedAiMaterialScore,
    mappedTotalScore: null,
    normalizedEvidenceItems: [],
    warnings: [],
    scoreItems,
  };
}

function validateMaterialMetrics(scoreJson, criteria) {
  const material = extractScoreMetrics(scoreJson);
  const paths = [];
  const details = {};

  if (material.scoreItems.length === 0) {
    paths.push("scoreItems");
  }

  const expectedCriteria = criteria.map((criterion) => ({
    name: criterion.name,
    weight: criterion.weight,
  }));
  const expectedCriteriaByName = new Map(
    expectedCriteria.map((criterion) => [criterion.name, criterion]),
  );
  const seenCriteria = new Set();
  const duplicateCriteria = [];
  const unknownCriteria = [];
  const invalidMaxScores = [];
  const invalidEvidenceStrengths = [];
  const invalidRiskLevels = [];
  const missingEvidenceText = [];
  const strongMissingEvidenceText = [];
  const normalizedMissingEvidenceText = [];

  for (const [index, item] of material.scoreItems.entries()) {
    if (!item.criterion) {
      paths.push(`scoreItems[${index}].criterion`);
      continue;
    }

    const criterion = expectedCriteriaByName.get(item.criterion);
    if (!criterion) {
      unknownCriteria.push(item.criterion);
      continue;
    }

    if (seenCriteria.has(item.criterion)) {
      duplicateCriteria.push(item.criterion);
    }
    seenCriteria.add(item.criterion);

    if (item.maxScore !== null && item.maxScore !== criterion.weight) {
      invalidMaxScores.push({
        criterion: item.criterion,
        maxScore: item.maxScore,
        expectedMaxScore: criterion.weight,
      });
    }

    if (!item.evidenceStrength) {
      invalidEvidenceStrengths.push(item.criterion);
    }

    if (!item.riskLevel) {
      invalidRiskLevels.push(item.criterion);
    }

    if (!item.hasEvidenceText) {
      missingEvidenceText.push(item.criterion);
    }

    if (
      item.evidenceStrength === "STRONG" &&
      item.evidenceTextIndicatesMissing
    ) {
      strongMissingEvidenceText.push(item.criterion);
    }

    if (
      item.evidenceStrength === "MISSING" &&
      !item.evidenceTextIndicatesMissing
    ) {
      normalizedMissingEvidenceText.push(item.criterion);
      item.evidenceTextIndicatesMissing = true;
    }

    const mapped = deriveMappedScore({
      criterion: item.criterion,
      maxScore: criterion.weight,
      evidenceStrength: item.evidenceStrength,
      riskLevel: item.riskLevel,
    });
    item.mappedScore = mapped.mappedScore;
    item.evidenceStrength = mapped.evidenceStrength;
    item.riskLevel = mapped.riskLevel;
  }

  const missingCriteria = expectedCriteria
    .map((criterion) => criterion.name)
    .filter((criterionName) => !seenCriteria.has(criterionName));
  material.mappedTotalScore = material.scoreItems.reduce(
    (sum, item) => sum + (item.mappedScore ?? 0),
    0,
  );

  if (material.scoreItems.length !== criteria.length) {
    details.expectedScoreItemCount = criteria.length;
    details.actualScoreItemCount = material.scoreItems.length;
  }
  if (missingCriteria.length > 0) details.missingCriteria = missingCriteria;
  if (duplicateCriteria.length > 0) details.duplicateCriteria = duplicateCriteria;
  if (unknownCriteria.length > 0) details.unknownCriteria = unknownCriteria;
  if (invalidMaxScores.length > 0) details.invalidMaxScores = invalidMaxScores;
  if (invalidEvidenceStrengths.length > 0) {
    details.invalidEvidenceStrengths = invalidEvidenceStrengths;
  }
  if (invalidRiskLevels.length > 0) details.invalidRiskLevels = invalidRiskLevels;
  if (missingEvidenceText.length > 0) {
    details.missingEvidenceText = missingEvidenceText;
  }
  if (strongMissingEvidenceText.length > 0) {
    details.strongMissingEvidenceText = strongMissingEvidenceText;
  }
  if (normalizedMissingEvidenceText.length > 0) {
    material.normalizedEvidenceItems = normalizedMissingEvidenceText;
    material.warnings.push({
      type: "normalizedMissingEvidenceText",
      criteria: normalizedMissingEvidenceText,
    });
    details.normalizedMissingEvidenceText = normalizedMissingEvidenceText;
  }

  if (
    paths.length > 0 ||
    missingCriteria.length > 0 ||
    invalidEvidenceStrengths.length > 0 ||
    invalidRiskLevels.length > 0 ||
    missingEvidenceText.length > 0
  ) {
    return {
      status: "missing_fields",
      material,
      error: makeDiagnosticError(
        "missing_fields",
        "Material evidence result is missing required structured evidence fields.",
        paths,
        details,
      ),
    };
  }

  if (
    material.scoreItems.length !== criteria.length ||
    duplicateCriteria.length > 0 ||
    unknownCriteria.length > 0 ||
    invalidMaxScores.length > 0 ||
    strongMissingEvidenceText.length > 0
  ) {
    return {
      status: "schema_validation_failed",
      material,
      error: makeDiagnosticError(
        "schema_validation_failed",
        "Material evidence result failed structural evidence validation.",
        [],
        details,
      ),
    };
  }

  return {
    status: "success",
    material,
    error: null,
  };
}

function extractAnalysisMetrics(analysisJson) {
  const qaReviews = Array.isArray(analysisJson.qaReviews)
    ? analysisJson.qaReviews.map((review) => ({
        questionId: String(review.questionId ?? ""),
        questionIndex: readNumber(review.questionIndex),
        responseQuality: String(review.responseQuality ?? ""),
      }))
    : [];

  return {
    overallScore: readNumber(analysisJson.overallScore),
    qaReviews,
  };
}

function isRecord(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function validatePitchAnalysisMetrics(analysisJson, qaData) {
  const performance = extractAnalysisMetrics(analysisJson);
  const paths = [];
  const details = {};

  if (performance.overallScore === null) {
    paths.push("overallScore");
  } else if (performance.overallScore < 0 || performance.overallScore > 100) {
    details.invalidOverallScore = performance.overallScore;
  }

  const requiredChecks = [
    ["summary", (value) => typeof value === "string"],
    ["strengths", Array.isArray],
    ["weaknesses", Array.isArray],
    ["suggestions", Array.isArray],
    ["onePageSummary", isRecord],
    ["onePageSummary.conclusion", (value) => typeof value === "string"],
    ["onePageSummary.strongestPoint", (value) => typeof value === "string"],
    ["onePageSummary.biggestWeakness", (value) => typeof value === "string"],
    ["onePageSummary.nextTrainingFocus", (value) => typeof value === "string"],
    ["onePageSummary.readinessAdvice", (value) => typeof value === "string"],
    ["diagnostics", isRecord],
    ["diagnostics.content", Array.isArray],
    ["diagnostics.delivery", Array.isArray],
    ["diagnostics.qa", Array.isArray],
    ["actionItems", Array.isArray],
    ["nextTrainingTasks", Array.isArray],
    ["contentCoverage", Array.isArray],
    ["timing", isRecord],
    ["slideSync", isRecord],
    ["riskQuestions", Array.isArray],
    ["qaReviews", Array.isArray],
  ];

  for (const [pathExpression, predicate] of requiredChecks) {
    const value = pathExpression.split(".").reduce((current, key) => {
      if (current && typeof current === "object") return current[key];
      return undefined;
    }, analysisJson);

    if (!predicate(value)) {
      paths.push(pathExpression);
    }
  }

  if (qaData.length > 0 && performance.qaReviews.length === 0) {
    paths.push("qaReviews");
    details.expectedQaReviewCount = qaData.length;
    details.actualQaReviewCount = performance.qaReviews.length;
  }

  const reviewedQuestionIds = new Set(
    performance.qaReviews.map((review) => review.questionId),
  );
  const missingQaReviewQuestionIds = qaData
    .map((question) => question.questionId)
    .filter((questionId) => !reviewedQuestionIds.has(questionId));

  if (missingQaReviewQuestionIds.length > 0) {
    details.missingQaReviewQuestionIds = missingQaReviewQuestionIds;
  }

  if (details.invalidOverallScore !== undefined) {
    return {
      status: "schema_validation_failed",
      performance,
      error: makeDiagnosticError(
        "schema_validation_failed",
        "Pitch analysis overallScore is outside the allowed range.",
        [],
        details,
      ),
    };
  }

  if (paths.length > 0 || missingQaReviewQuestionIds.length > 0) {
    return {
      status: "missing_fields",
      performance,
      error: makeDiagnosticError(
        "missing_fields",
        "Pitch analysis result is missing required structured fields.",
        [...new Set(paths)],
        details,
      ),
    };
  }

  return {
    status: "success",
    performance,
    error: null,
  };
}

function normalizeWeights(materialWeight, performanceWeight) {
  const material = Number.isFinite(materialWeight)
    ? materialWeight
    : DEFAULT_MATERIAL_WEIGHT;
  const performance = Number.isFinite(performanceWeight)
    ? performanceWeight
    : DEFAULT_PERFORMANCE_WEIGHT;
  const total = material + performance;
  if (material < 0 || performance < 0 || total <= 0) {
    throw new Error("Composite score weights must be non-negative and sum to > 0.");
  }
  return {
    material: material / total,
    performance: performance / total,
  };
}

function deriveCompositeScore(materialScore, performanceScore, weights) {
  if (materialScore === null || performanceScore === null) return null;
  return Math.round(
    materialScore * weights.material + performanceScore * weights.performance,
  );
}

function stats(values) {
  const cleanValues = values.filter(
    (value) => typeof value === "number" && Number.isFinite(value),
  );
  if (cleanValues.length === 0) {
    return {
      count: 0,
      min: null,
      max: null,
      range: null,
      mean: null,
      standardDeviation: null,
    };
  }

  const min = Math.min(...cleanValues);
  const max = Math.max(...cleanValues);
  const mean =
    cleanValues.reduce((total, value) => total + value, 0) / cleanValues.length;
  const variance =
    cleanValues.reduce((total, value) => total + (value - mean) ** 2, 0) /
    cleanValues.length;

  return {
    count: cleanValues.length,
    min,
    max,
    range: max - min,
    mean: Number(mean.toFixed(2)),
    standardDeviation: Number(Math.sqrt(variance).toFixed(2)),
  };
}

function summarizeRuns(runs) {
  const scoreItemNames = [
    ...new Set(
      runs.flatMap((run) =>
        run.material.scoreItems.length > 0
          ? run.material.scoreItems.map((item) => item.criterion)
          : [],
      ),
    ),
  ];
  const qaQuestionIds = [
    ...new Set(
      runs.flatMap((run) =>
        run.pitchAnalysisStatus === "success"
          ? run.performance.qaReviews.map((review) => review.questionId)
          : [],
      ),
    ),
  ];
  const observedAiMaterialRuns = runs.filter(
    (run) => run.material.observedAiMaterialScore !== null,
  );
  const validMappedMaterialRuns = runs.filter(
    (run) =>
      run.materialStatus === "success" && run.material.mappedTotalScore !== null,
  );
  const successfulPitchRuns = runs.filter(
    (run) => run.pitchAnalysisStatus === "success",
  );
  const successfulCompositeRuns = runs.filter(
    (run) =>
      run.materialStatus === "success" && run.pitchAnalysisStatus === "success",
  );

  return {
    observedAiMaterialScore: stats(
      observedAiMaterialRuns.map((run) => run.material.observedAiMaterialScore),
    ),
    validMappedMaterialScore: stats(
      validMappedMaterialRuns.map((run) => run.material.mappedTotalScore),
    ),
    invalidMaterialRuns: runs
      .filter((run) => run.materialStatus !== "success")
      .map((run) => ({
        runIndex: run.runIndex,
        status: run.materialStatus,
        error: run.materialError,
      })),
    normalizedMaterialEvidenceItems: runs.flatMap((run) =>
      (run.material.normalizedEvidenceItems ?? []).map((criterion) => ({
        runIndex: run.runIndex,
        criterion,
      })),
    ),
    materialWarnings: runs.flatMap((run) =>
      (run.material.warnings ?? []).map((warning) => ({
        runIndex: run.runIndex,
        ...warning,
      })),
    ),
    performanceOverallScore: stats(
      successfulPitchRuns.map((run) => run.performance.overallScore),
    ),
    compositeScore: stats(successfulCompositeRuns.map((run) => run.compositeScore)),
    scoreItems: scoreItemNames.map((criterion) => {
      const rounds = runs
        .map((run) => {
          const item = run.material.scoreItems.find(
            (scoreItem) => scoreItem.criterion === criterion,
          );

          if (!item) return null;

          return {
            runIndex: run.runIndex,
            aiSuggestedScore: item.aiSuggestedScore,
            mappedScore: item.mappedScore,
            evidenceStrength: item.evidenceStrength,
            riskLevel: item.riskLevel,
          };
        })
        .filter(Boolean);
      const aiSuggestedScoreStats = stats(
        rounds.map((round) => round.aiSuggestedScore),
      );
      const mappedScoreStats = stats(
        rounds.map((round) => round.mappedScore),
      );

      return {
        criterion,
        aiSuggestedScore: aiSuggestedScoreStats,
        mappedScore: mappedScoreStats,
        evidenceStrengthCounts: rounds.reduce((result, round) => {
          const key = round.evidenceStrength ?? "MISSING";
          result[key] = (result[key] ?? 0) + 1;
          return result;
        }, {}),
        riskLevelCounts: rounds.reduce((result, round) => {
          const key = round.riskLevel ?? "UNKNOWN";
          result[key] = (result[key] ?? 0) + 1;
          return result;
        }, {}),
        rounds,
      };
    }),
    largestEvidenceStrengthVolatilityContributors: scoreItemNames
      .map((criterion) => {
        const rounds = runs
          .map((run) =>
            run.material.scoreItems.find(
              (scoreItem) => scoreItem.criterion === criterion,
            ),
          )
          .filter(Boolean);
        const uniqueEvidenceStrengthCount = new Set(
          rounds.map((item) => item.evidenceStrength),
        ).size;

        return {
          criterion,
          uniqueEvidenceStrengthCount,
          evidenceStrengthCounts: rounds.reduce((result, item) => {
            const key = item.evidenceStrength ?? "MISSING";
            result[key] = (result[key] ?? 0) + 1;
            return result;
          }, {}),
        };
      })
      .sort(
        (first, second) =>
          second.uniqueEvidenceStrengthCount - first.uniqueEvidenceStrengthCount,
      )
      .slice(0, 5),
    largestMappedScoreVolatilityContributors: scoreItemNames
      .map((criterion) => {
        const rounds = runs
          .map((run) =>
            run.material.scoreItems.find(
              (scoreItem) => scoreItem.criterion === criterion,
            ),
          )
          .filter(Boolean);
        const aiSuggestedScoreStats = stats(
          rounds.map((item) => item.aiSuggestedScore),
        );
        const mappedScoreStats = stats(rounds.map((item) => item.mappedScore));

        return {
          criterion,
          aiSuggestedScoreRange: aiSuggestedScoreStats.range,
          aiSuggestedScoreStandardDeviation:
            aiSuggestedScoreStats.standardDeviation,
          mappedScoreRange: mappedScoreStats.range,
          mappedScoreStandardDeviation: mappedScoreStats.standardDeviation,
        };
      })
      .sort(
        (first, second) =>
          (second.mappedScoreRange ?? -1) - (first.mappedScoreRange ?? -1),
      )
      .slice(0, 5),
    qaResponseQuality: qaQuestionIds.map((questionId) => {
      const values = successfulPitchRuns
        .map((run) =>
          run.performance.qaReviews.find(
            (review) => review.questionId === questionId,
          ),
        )
        .filter(Boolean)
        .map((review) => review.responseQuality);
      return {
        questionId,
        counts: values.reduce((result, value) => {
          result[value] = (result[value] ?? 0) + 1;
          return result;
        }, {}),
      };
    }),
    errors: runs
      .flatMap((run) => {
        const errors = [];
        if (run.materialStatus !== "success") {
          errors.push({
            runIndex: run.runIndex,
            phase: "material",
            status: run.materialStatus,
            error: run.materialError,
          });
        }
        if (run.pitchAnalysisStatus !== "success") {
          errors.push({
            runIndex: run.runIndex,
            phase: "pitchAnalysis",
            status: run.pitchAnalysisStatus,
            error: run.pitchAnalysisError,
          });
        }
        return errors;
      }),
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const env = loadEnv();

  if (args.printConfig) {
    console.log(JSON.stringify(getModelConfig(env), null, 2));
    return;
  }

  const { PrismaClient } = await import("@prisma/client");
  const prisma = new PrismaClient();
  try {
    if (args.listCandidates) {
      console.log(JSON.stringify(await listCandidates(prisma), null, 2));
      return;
    }

    let projectId = args.projectId;
    let sessionId = args.sessionId;

    if (!sessionId) {
      const candidate = await autoSelectCandidate(prisma);
      if (!candidate) {
        throw new Error(
          "No candidate session found. Run with --list-candidates and pass --session-id.",
        );
      }
      projectId = candidate.projectId;
      sessionId = candidate.sessionId;
      console.log(
        `Auto-selected session=${sessionId} project=${projectId} (${candidate.projectName}).`,
      );
    }

    if (!projectId) {
      const session = await prisma.trainingSession.findUnique({
        where: { id: sessionId },
        select: { projectId: true },
      });
      if (!session) throw new Error(`Session not found: ${sessionId}`);
      projectId = session.projectId;
    }

    const weights = normalizeWeights(args.materialWeight, args.performanceWeight);
    const model = getStrongModel(env);
    const [scoringTemplate, analysisTemplate] = [
      fs.readFileSync(path.join(PROJECT_ROOT, "prompts", "scoring.md"), "utf8"),
      fs.readFileSync(
        path.join(PROJECT_ROOT, "prompts", "pitch-performance-analysis.md"),
        "utf8",
      ),
    ];
    const context = await buildProjectContext(prisma, projectId);
    const sessionInput = await buildSessionInput(prisma, sessionId, projectId);
    const scoringPrompt = buildScoringPrompt(context, scoringTemplate);
    const analysisPrompt = buildAnalysisPrompt(
      context,
      analysisTemplate,
      sessionInput,
    );
    const promptHashes = {
      scoring: hashText(scoringTemplate),
      pitchPerformanceAnalysis: hashText(analysisTemplate),
      scoringRendered: hashText(scoringPrompt),
      pitchPerformanceAnalysisRendered: hashText(analysisPrompt),
    };
    const runs = [];

    for (let runIndex = 1; runIndex <= args.runs; runIndex += 1) {
      const generatedAt = new Date().toISOString();
      const run = {
        runIndex,
        generatedAt,
        model,
        materialStatus: "unknown_error",
        pitchAnalysisStatus: "unknown_error",
        materialError: null,
        pitchAnalysisError: null,
        materialElapsedMs: null,
        pitchAnalysisElapsedMs: null,
        elapsedMs: {
          scoring: null,
          pitchAnalysis: null,
        },
        material: {
          observedAiMaterialScore: null,
          mappedTotalScore: null,
          normalizedEvidenceItems: [],
          warnings: [],
          scoreItems: [],
        },
        performance: { overallScore: null, qaReviews: [] },
        compositeScore: null,
      };

      console.log(`[${runIndex}/${args.runs}] Running material scoring...`);
      try {
        const scoringResult = await callAI({
          env,
          model,
          systemPrompt:
            "你是严格遵循 JSON 输出约束的路演大赛评分专家。只输出合法 JSON，不输出 Markdown 或额外解释。",
          userPrompt: scoringPrompt,
          temperature: 0.1,
        });
        run.materialElapsedMs = scoringResult.elapsedMs;
        run.elapsedMs.scoring = scoringResult.elapsedMs;
        const parsedScore = parseJsonForPhase(scoringResult.text);

        if (parsedScore.status !== "success") {
          run.materialStatus = parsedScore.status;
          run.materialError = parsedScore.error;
        } else {
          const materialValidation = validateMaterialMetrics(
            parsedScore.value,
            context.criteria,
          );
          run.materialStatus = materialValidation.status;
          run.material = materialValidation.material;
          run.materialError = materialValidation.error;
        }
      } catch (error) {
        run.materialStatus = classifyError(error);
        run.materialError = makeDiagnosticError(
          run.materialStatus,
          sanitizeErrorMessage(error, env),
        );
      }

      console.log(`[${runIndex}/${args.runs}] Running pitch analysis...`);
      try {
        const analysisResult = await callAI({
          env,
          model,
          systemPrompt:
            "你是严格遵守 JSON 输出约束的专业路演训练教练。只输出合法 JSON，不输出 Markdown 或额外解释。",
          userPrompt: analysisPrompt,
          temperature: 0.2,
        });
        run.pitchAnalysisElapsedMs = analysisResult.elapsedMs;
        run.elapsedMs.pitchAnalysis = analysisResult.elapsedMs;
        const parsedAnalysis = parseJsonForPhase(analysisResult.text);

        if (parsedAnalysis.status !== "success") {
          run.pitchAnalysisStatus = parsedAnalysis.status;
          run.pitchAnalysisError = parsedAnalysis.error;
        } else {
          const pitchValidation = validatePitchAnalysisMetrics(
            parsedAnalysis.value,
            sessionInput.qaData,
          );
          run.pitchAnalysisStatus = pitchValidation.status;
          run.performance = pitchValidation.performance;
          run.pitchAnalysisError = pitchValidation.error;
        }
      } catch (error) {
        run.pitchAnalysisStatus = classifyError(error);
        run.pitchAnalysisError = makeDiagnosticError(
          run.pitchAnalysisStatus,
          sanitizeErrorMessage(error, env),
        );
      }

      run.compositeScore =
        run.materialStatus === "success" && run.pitchAnalysisStatus === "success"
          ? deriveCompositeScore(
              run.material.mappedTotalScore,
              run.performance.overallScore,
              weights,
            )
          : null;

      runs.push(run);
    }

    const output = {
      generatedAt: new Date().toISOString(),
      projectId,
      sessionId,
      runsRequested: args.runs,
      models: {
        scoring: model,
        pitchAnalysis: model,
      },
      prompts: {
        scoring: {
          file: "prompts/scoring.md",
          sha256: promptHashes.scoring,
        },
        pitchPerformanceAnalysis: {
          file: "prompts/pitch-performance-analysis.md",
          sha256: promptHashes.pitchPerformanceAnalysis,
        },
        renderedPromptHashes: {
          scoring: promptHashes.scoringRendered,
          pitchPerformanceAnalysis: promptHashes.pitchPerformanceAnalysisRendered,
        },
      },
      fixedInputs: {
        projectName: context.project.name,
        evaluationRule: context.evaluationRule,
        criteriaCount: context.criteria.length,
        fileCount: context.files.length,
        pitchTranscriptId: sessionInput.transcript.id,
        qaQuestionCount: sessionInput.qaData.length,
        hasDynamicFollowup: Boolean(sessionInput.dynamicFollowupData),
      },
      compositeFormula: {
        formula: "round(materialScore * materialWeight + performanceScore * performanceWeight)",
        weights,
      },
      summary: summarizeRuns(runs),
      runs,
    };

    fs.mkdirSync(args.outDir, { recursive: true });
    const filename = `scoring-v2-stability-${new Date()
      .toISOString()
      .replace(/[:.]/g, "-")}.json`;
    const outputPath = path.join(args.outDir, filename);
    fs.writeFileSync(outputPath, `${JSON.stringify(output, null, 2)}\n`);

    console.log(JSON.stringify(output.summary, null, 2));
    console.log(`Wrote ${outputPath}`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
