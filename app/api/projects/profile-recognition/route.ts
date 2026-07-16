import { callAI } from "@/lib/ai";
import { parseFirstAIJsonObject } from "@/lib/json-utils";
import { loadPromptTemplate } from "@/lib/prompt-loader";
import { isAuthEnabled } from "@/lib/auth";
import { getCurrentAuthUser } from "@/lib/auth-server";
import {
  extractLooseProjectProfile,
  normalizeProjectField,
  normalizeTechnicalKeywords,
} from "@/lib/project-profile";
import {
  assessTrlFromEvidence,
  buildLayeredRecognitionInput,
  createDefaultTrlEvidence,
  inspectTrlEvidencePayload,
  parseTrlEvidence,
  type TrlEvidence,
} from "@/lib/trl-assessment";
import { isRecord } from "@/lib/type-guards";

const MATERIAL_PARSE_FAILURE_MESSAGE =
  "材料解析失败，请更换文件或手动填写项目档案。";
const AI_FAILURE_MESSAGE = "AI 暂未完成项目档案识别，你可以手动填写。";
const PROFILE_UNAVAILABLE_MESSAGE =
  "AI 返回内容暂未提取到项目档案，你可以手动填写项目档案。";
const TRL_FAILURE_MESSAGE =
  "项目档案已识别，TRL 成熟度暂未自动判断，请根据项目实际情况选择。";
const PARTIAL_PROFILE_MESSAGE = "部分字段未识别到，请手动补充。";
const IS_DEVELOPMENT = process.env.NODE_ENV === "development";
const BASE_PROFILE_TEXT_LIMIT = 30_000;

type BaseProjectProfile = {
  name: string | null;
  summary: string | null;
  field: string | null;
  applicationScenario: string | null;
  technicalKeywords: string[];
  productForm: string | null;
};

type ProjectProfileRecognition = BaseProjectProfile & {
  trl: string | null;
  trlReason: string | null;
  trlEvidence: TrlEvidence;
  trlRuleAssessment: ReturnType<typeof assessTrlFromEvidence> | null;
};

type FailureReason =
  | "material_parse_failed"
  | "ai_call_failed"
  | "profile_unavailable";

type TrlEvidenceAttempt =
  | {
      status: "recognized";
      evidence: TrlEvidence;
      source: "initial" | "retry";
    }
  | {
      status: "unavailable";
      reason: string;
    };

type TrlRecognitionResult = {
  status: "recognized" | "failed";
  evidence: TrlEvidence;
  assessment: ReturnType<typeof assessTrlFromEvidence> | null;
  trl: string | null;
  reason: string | null;
  resolution: "initial" | "retry" | "unavailable";
};

function debugLog(stage: string, details: unknown) {
  if (IS_DEVELOPMENT) {
    console.info(`[project-profile-recognition] ${stage}`, details);
  }
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

function asRecognitionRecord(value: unknown): Record<string, unknown> {
  if (isRecord(value)) return value;
  if (Array.isArray(value)) {
    return (
      value.find((item): item is Record<string, unknown> => isRecord(item)) ??
      {}
    );
  }
  return {};
}

function readOptionalString(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function normalizeBaseProfile(value: Record<string, unknown>): BaseProjectProfile {
  const rawField = readOptionalString(value.field);

  return {
    name: readOptionalString(value.name),
    summary: readOptionalString(value.summary),
    field: rawField ? normalizeProjectField(rawField) : null,
    applicationScenario: readOptionalString(value.applicationScenario),
    technicalKeywords: normalizeTechnicalKeywords(value.technicalKeywords),
    productForm: readOptionalString(value.productForm),
  };
}

function hasBaseProfile(profile: BaseProjectProfile) {
  return Boolean(
    profile.name ||
      profile.summary ||
      profile.field ||
      profile.applicationScenario ||
      profile.technicalKeywords.length > 0 ||
      profile.productForm,
  );
}

function hasMissingRequiredBaseField(profile: BaseProjectProfile) {
  return !(
    profile.name &&
    profile.summary &&
    profile.field &&
    profile.applicationScenario &&
    profile.technicalKeywords.length > 0
  );
}

function buildBaseRecognitionInput(fileName: string, sourceText: string) {
  return [
    `【文件：${fileName}】`,
    "【项目基础信息材料】",
    sourceText.slice(0, BASE_PROFILE_TEXT_LIMIT),
  ].join("\n\n");
}

async function requestTrlEvidence({
  systemPrompt,
  userPrompt,
  sourceText,
  attempt,
}: {
  systemPrompt: string;
  userPrompt: string;
  sourceText: string;
  attempt: "initial" | "retry";
}): Promise<TrlEvidenceAttempt> {
  let rawText: string;

  try {
    const result = await callAI({
      task: "trlAssessment",
      systemPrompt,
      userPrompt,
      temperature: 0,
      maxOutputTokens: 3_200,
      seed: 20_260_622,
    });
    rawText = result.text;
    debugLog(
      attempt === "retry"
        ? "trl_retry_raw_preview"
        : "trl_initial_raw_preview",
      rawText.slice(0, 1_000),
    );
  } catch (error) {
    const reason = `TRL-only AI 调用失败：${errorMessage(error)}`;
    debugLog(`trl_${attempt}_call_failed`, { reason });
    return { status: "unavailable", reason };
  }

  let parsed: Record<string, unknown>;

  try {
    parsed = parseFirstAIJsonObject(rawText);
  } catch (error) {
    const reason = `TRL-only JSON 解析失败：${errorMessage(error)}`;
    debugLog(`trl_${attempt}_json_failed`, { reason });
    return { status: "unavailable", reason };
  }

  const inspection = inspectTrlEvidencePayload(parsed);
  debugLog(`trl_${attempt}_structure`, {
    containsTrlEvidence: Object.prototype.hasOwnProperty.call(
      parsed,
      "trlEvidence",
    ),
    usable: inspection.usable,
    reason: inspection.usable ? null : inspection.reason,
  });

  if (!inspection.usable) {
    return { status: "unavailable", reason: inspection.reason };
  }

  const evidence = parseTrlEvidence(inspection.payload, sourceText);
  debugLog(`trl_${attempt}_normalized`, evidence);
  return { status: "recognized", evidence, source: attempt };
}

async function recognizeTrl(
  fileName: string,
  sourceText: string,
): Promise<TrlRecognitionResult> {
  let trlAttempt: TrlEvidenceAttempt = {
    status: "unavailable",
    reason: "TRL-only prompt 未加载",
  };

  try {
    const trlPrompt = await loadPromptTemplate(
      "project-trl-evidence-recognition",
    );
    const trlInput = buildLayeredRecognitionInput(fileName, sourceText);
    trlAttempt = await requestTrlEvidence({
      systemPrompt: trlPrompt,
      userPrompt: trlInput,
      sourceText,
      attempt: "initial",
    });

    if (trlAttempt.status === "unavailable") {
      debugLog("trl_evidence_unavailable", {
        reason: trlAttempt.reason,
      });
      debugLog("trl_retry_triggered", { triggered: true });
      trlAttempt = await requestTrlEvidence({
        systemPrompt: trlPrompt,
        userPrompt: `${trlInput}\n\n【重试要求】上一次未返回可用证据结构。请只返回一个完整、闭合、合法的 trlEvidence JSON 对象，不要输出解释。`,
        sourceText,
        attempt: "retry",
      });
      debugLog("trl_retry_result", {
        succeeded: trlAttempt.status === "recognized",
        reason:
          trlAttempt.status === "unavailable" ? trlAttempt.reason : null,
      });
    }
  } catch (error) {
    debugLog("trl_prompt_or_retry_failed", { error: errorMessage(error) });
  }

  if (trlAttempt.status === "unavailable") {
    debugLog("trl_final_resolution", {
      resolution: "unavailable",
      trl: null,
    });
    return {
      status: "failed",
      evidence: createDefaultTrlEvidence(),
      assessment: null,
      trl: null,
      reason: null,
      resolution: "unavailable",
    };
  }

  try {
    const assessment = assessTrlFromEvidence(
      trlAttempt.evidence,
      sourceText,
    );
    debugLog("trl_rule_succeeded", assessment);
    debugLog("trl_final_resolution", {
      resolution: trlAttempt.source,
      trl: assessment.trl,
    });
    return {
      status: "recognized",
      evidence: trlAttempt.evidence,
      assessment,
      trl: assessment.trl,
      reason: assessment.reason,
      resolution: trlAttempt.source,
    };
  } catch (error) {
    debugLog("trl_rule_failed", { error: errorMessage(error) });
    debugLog("trl_final_resolution", {
      resolution: "unavailable",
      trl: null,
    });
    return {
      status: "failed",
      evidence: trlAttempt.evidence,
      assessment: null,
      trl: null,
      reason: null,
      resolution: "unavailable",
    };
  }
}

function failedResponse(reason: FailureReason, message: string, status: number) {
  return Response.json(
    {
      status: "failed",
      reason,
      message,
    },
    { status },
  );
}

export async function POST(request: Request) {
  if (isAuthEnabled() && !(await getCurrentAuthUser())) {
    return Response.json(
      { status: "unauthorized", message: "请先登录后再使用该功能。" },
      { status: 401 },
    );
  }

  let body: {
    fileName?: unknown;
    extractedText?: unknown;
    mode?: unknown;
  };

  try {
    body = (await request.json()) as typeof body;
  } catch (error) {
    debugLog("request_json_failed", { error: errorMessage(error) });
    return failedResponse(
      "material_parse_failed",
      MATERIAL_PARSE_FAILURE_MESSAGE,
      400,
    );
  }

  if (
    typeof body.fileName !== "string" ||
    typeof body.extractedText !== "string" ||
    !body.extractedText.trim()
  ) {
    debugLog("material_parse_invalid", {
      hasFileName: typeof body.fileName === "string",
      extractedTextLength:
        typeof body.extractedText === "string" ? body.extractedText.length : 0,
    });
    return failedResponse(
      "material_parse_failed",
      MATERIAL_PARSE_FAILURE_MESSAGE,
      422,
    );
  }

  const fileName = body.fileName;
  const sourceText = body.extractedText;
  const mode =
    body.mode === "base" || body.mode === "trl" || body.mode === "full"
      ? body.mode
      : "full";
  debugLog("material_parse_succeeded", {
    fileName,
    extractedTextLength: sourceText.length,
    mode,
  });

  if (mode === "trl") {
    const trlResult = await recognizeTrl(fileName, sourceText);

    return Response.json({
      status: "recognized",
      mode: "trl",
      trlStatus: trlResult.status,
      notices:
        trlResult.status === "failed" ? [TRL_FAILURE_MESSAGE] : [],
      profile: {
        trl: trlResult.trl,
        trlReason: trlResult.reason,
      },
    });
  }

  let baseRawText: string;

  try {
    const basePrompt = await loadPromptTemplate("project-profile-recognition");
    const baseResult = await callAI({
      task: "projectProfileRecognition",
      systemPrompt: basePrompt,
      userPrompt: buildBaseRecognitionInput(fileName, sourceText),
      temperature: 0,
      maxOutputTokens: 1_200,
      seed: 20_260_622,
    });
    baseRawText = baseResult.text;
    debugLog("base_ai_raw_preview", baseRawText.slice(0, 1_000));
  } catch (error) {
    debugLog("base_ai_call_failed", { error: errorMessage(error) });
    return failedResponse("ai_call_failed", AI_FAILURE_MESSAGE, 502);
  }

  let baseParsedValue: unknown = null;

  try {
    baseParsedValue = parseFirstAIJsonObject(baseRawText);
    debugLog("base_json_parse_succeeded", {
      parsedType: typeof baseParsedValue,
    });
  } catch (error) {
    debugLog("base_json_parse_failed", { error: errorMessage(error) });
  }

  const baseParsedRecord = asRecognitionRecord(baseParsedValue);
  debugLog("base_ai_contains_trl_evidence", {
    containsTrlEvidence:
      Object.prototype.hasOwnProperty.call(
        baseParsedRecord,
        "trlEvidence",
      ) || baseRawText.includes('"trlEvidence"'),
  });
  const normalizedBase = normalizeBaseProfile({
    ...extractLooseProjectProfile(baseRawText),
    ...baseParsedRecord,
  });
  const baseSucceeded = hasBaseProfile(normalizedBase);

  debugLog("profile_base_normalized", {
    succeeded: baseSucceeded,
    profile: normalizedBase,
  });

  if (!baseSucceeded) {
    return failedResponse(
      "profile_unavailable",
      PROFILE_UNAVAILABLE_MESSAGE,
      422,
    );
  }

  const baseStatus = hasMissingRequiredBaseField(normalizedBase)
    ? "partial"
    : "recognized";
  const baseNotices =
    baseStatus === "partial" ? [PARTIAL_PROFILE_MESSAGE] : [];

  if (mode === "base") {
    return Response.json({
      status: "recognized",
      mode: "base",
      baseStatus,
      notices: baseNotices,
      profile: normalizedBase,
    });
  }

  const trlResult = await recognizeTrl(fileName, sourceText);

  const notices = [...baseNotices];
  if (trlResult.status === "failed") notices.push(TRL_FAILURE_MESSAGE);

  const profile: ProjectProfileRecognition = {
    ...normalizedBase,
    trl: trlResult.trl,
    trlReason: trlResult.reason,
    trlEvidence: trlResult.evidence,
    trlRuleAssessment: trlResult.assessment,
  };

  return Response.json({
    status: "recognized",
    mode: "full",
    baseStatus,
    trlStatus: trlResult.status,
    notices,
    profile,
  });
}
