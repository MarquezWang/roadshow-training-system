import { callAI } from "@/lib/ai";
import { devLog, devWarn } from "@/lib/dev-log";
import {
  callContentDynamicFollowup,
  callMainDynamicFollowup,
  callMismatchDynamicFollowup,
} from "@/lib/dynamic-followup-ai";
import { evaluateContentFallbackEligibility } from "@/lib/dynamic-followup-fallback";
import {
  createOrReturnDynamicQuestion,
  type SerializedDynamicQuestion,
} from "@/lib/dynamic-followup-question";
import {
  MAX_DYNAMIC_FOLLOWUP_QUESTION_LENGTH,
  MIN_DYNAMIC_FOLLOWUP_QUESTION_LENGTH,
  normalizeMainMultipleQuestionText,
  validateFallbackFollowupText,
  validateMainFollowupText,
} from "@/lib/dynamic-followup-validation";
import type {
  DynamicFollowupDebugInfo,
  DynamicFollowupGenerationResult,
  PreparedDynamicFollowupInput,
} from "./dynamic-followup-types";
import { wrapUntrustedPromptData } from "@/lib/prompt-data-boundary";

const SHOULD_ATTEMPT_MISMATCH_FALLBACK = false;

function getBasicQuestionValidationReason(text: string) {
  if (!text) return "output_empty";
  if (text.length < MIN_DYNAMIC_FOLLOWUP_QUESTION_LENGTH) {
    return "output_too_short";
  }
  if (text.length > MAX_DYNAMIC_FOLLOWUP_QUESTION_LENGTH) {
    return "output_too_long";
  }
  if (!text.includes("?") && !text.includes("？")) {
    return "output_not_question";
  }
  return null;
}

async function attemptMismatchFallback(
  input: PreparedDynamicFollowupInput,
  debugInfo: DynamicFollowupDebugInfo,
): Promise<SerializedDynamicQuestion | null> {
  const {
    sessionId,
    projectId,
    projectName,
    projectContextText,
    transcriptText,
  } = input;
  debugInfo.fallbackAttempted = true;

  try {
    devLog("[dynamic-followup:POST] attempting mismatch fallback", {
      sessionId,
    });
    const mismatchResult = await callMismatchDynamicFollowup({
      projectId,
      projectTitle: projectName ?? "",
      projectContext: projectContextText.slice(0, 2000),
      pitchTranscript: transcriptText,
    });

    const fallbackRaw = mismatchResult.text;
    const fallbackText = fallbackRaw.trim();
    debugInfo.fallbackRawAiOutput = fallbackRaw;
    debugInfo.fallbackNormalizedOutput = fallbackText;

    if (fallbackText === "NO_DYNAMIC_FOLLOWUP") {
      debugInfo.fallbackValidationReason =
        "fallback_returned_no_dynamic_followup";
      debugInfo.fallbackUsed = false;
      devLog(
        "[dynamic-followup:POST] mismatch fallback also returned NO_DYNAMIC_FOLLOWUP",
        { sessionId },
      );
      return null;
    }

    const validationReason = getBasicQuestionValidationReason(fallbackText);
    if (validationReason) {
      debugInfo.fallbackValidationReason = validationReason.replace(
        "output_",
        "fallback_output_",
      );
      debugInfo.fallbackUsed = false;
      devWarn(
        "[dynamic-followup:POST] mismatch fallback returned invalid question",
        {
          sessionId,
          textLength: fallbackText.length,
          text: fallbackText.slice(0, 100),
        },
      );
      return null;
    }

    debugInfo.fallbackValidationReason = null;
    debugInfo.fallbackUsed = true;
    const createdQuestion = await createOrReturnDynamicQuestion({
      sessionId,
      projectId,
      questionText: fallbackText,
    });
    devLog(
      "[dynamic-followup:POST] mismatch fallback created dynamic question",
      {
        sessionId,
        createdQuestionId: createdQuestion.id,
        orderIndex: createdQuestion.orderIndex,
        textLength: fallbackText.length,
      },
    );
    debugInfo.usedStage = "mismatch";
    return createdQuestion;
  } catch (fallbackError) {
    debugInfo.fallbackValidationReason = "fallback_error";
    debugInfo.fallbackUsed = false;
    devWarn("[dynamic-followup:POST] mismatch fallback error", {
      sessionId,
      error: String(fallbackError),
    });
    return null;
  }
}

function buildContentFallbackRetryPrompt(input: PreparedDynamicFollowupInput) {
  return `请基于以下路演转写内容，生成 1 个评委追问。
要求：

1. 只输出问题文本；
2. 不输出解释；
3. 不输出 JSON；
4. 只能基于路演转写中明确出现的内容追问，不要引用项目材料和转写之间的差异；
5. 如果无法基于转写可靠生成追问，只输出 NO_DYNAMIC_FOLLOWUP；
6. 问题不超过 100 字；
7. 优先追问“讲到了但没有讲透”的点，例如验证方式、数据指标、落地计划、用户反馈、商业模式。

项目标题：
${wrapUntrustedPromptData("projectTitle", input.projectName ?? "")}

路演转写：
${wrapUntrustedPromptData("pitchTranscript", input.transcriptText.slice(0, 1200))}

已有问题，避免完全重复：
${wrapUntrustedPromptData("existingQuestions", input.otherQuestionsText.slice(0, 800))}`;
}

async function attemptContentFallbackRetry(
  input: PreparedDynamicFollowupInput,
  debugInfo: DynamicFollowupDebugInfo,
): Promise<SerializedDynamicQuestion | null> {
  const { sessionId, projectId, transcriptText, otherQuestions } = input;
  debugInfo.contentFallbackRetryAttempted = true;

  try {
    const retryResult = await callAI({
      task: "dynamicFollowup",
      projectId,
      systemPrompt: "你是一名专业路演答辩评委，只输出一个问题。",
      userPrompt: buildContentFallbackRetryPrompt(input),
      temperature: 0.1,
      maxOutputTokens: 300,
    });

    const retryRaw = retryResult.text;
    const retryText = retryRaw.trim();
    debugInfo.contentFallbackRetryRawAiOutput = retryRaw;
    debugInfo.contentFallbackRetryNormalizedOutput = retryText;

    if (retryText === "NO_DYNAMIC_FOLLOWUP") {
      debugInfo.contentFallbackRetryValidationReason =
        "retry_returned_no_dynamic_followup";
      debugInfo.contentFallbackRetryUsed = false;
      debugInfo.contentFallbackValidationReason = "content_fallback_error";
      debugInfo.contentFallbackUsed = false;
      return null;
    }

    const retryValidationReason = validateFallbackFollowupText({
      text: retryText,
      transcriptText,
      regularQuestions: otherQuestions,
    });
    if (retryValidationReason) {
      debugInfo.contentFallbackRetryValidationReason = retryValidationReason;
      debugInfo.contentFallbackRetryUsed = false;
      debugInfo.contentFallbackValidationReason = "content_fallback_error";
      debugInfo.contentFallbackUsed = false;
      return null;
    }

    debugInfo.contentFallbackRetryValidationReason = null;
    debugInfo.contentFallbackRetryUsed = true;
    debugInfo.contentFallbackValidationReason = null;
    debugInfo.contentFallbackUsed = true;
    const createdQuestion = await createOrReturnDynamicQuestion({
      sessionId,
      projectId,
      questionText: retryText,
    });
    devLog(
      "[dynamic-followup:POST] content fallback retry created dynamic question",
      {
        sessionId,
        createdQuestionId: createdQuestion.id,
        orderIndex: createdQuestion.orderIndex,
        textLength: retryText.length,
        questionText: retryText,
      },
    );
    debugInfo.usedStage = "content";
    return createdQuestion;
  } catch (retryError) {
    debugInfo.contentFallbackRetryValidationReason = "retry_error";
    debugInfo.contentFallbackRetryUsed = false;
    debugInfo.contentFallbackValidationReason = "content_fallback_error";
    debugInfo.contentFallbackUsed = false;
    devWarn("[dynamic-followup:POST] content fallback retry also failed", {
      sessionId,
      error: String(retryError),
    });
    return null;
  }
}

async function attemptContentFallback(
  input: PreparedDynamicFollowupInput,
  debugInfo: DynamicFollowupDebugInfo,
): Promise<SerializedDynamicQuestion | null> {
  const {
    sessionId,
    projectId,
    projectName,
    projectContextText,
    transcriptText,
    otherQuestions,
    otherQuestionsText,
  } = input;
  const eligibility = evaluateContentFallbackEligibility(transcriptText);
  debugInfo.hasPitchProjectContent = eligibility.hasPitchProjectContent;
  debugInfo.pitchProjectContentMatchedKeywords = eligibility.matchedKeywords;

  if (!eligibility.shouldAttemptContentFallback) {
    return null;
  }

  debugInfo.contentFallbackAttempted = true;
  try {
    devLog("[dynamic-followup:POST] attempting content fallback", {
      sessionId,
    });
    const contentResult = await callContentDynamicFollowup({
      projectId,
      projectTitle: projectName ?? "",
      projectContext: projectContextText.slice(0, 2000),
      pitchTranscript: transcriptText,
      existingQuestions: otherQuestionsText,
    });

    const contentRaw = contentResult.text;
    const contentText = contentRaw.trim();
    debugInfo.contentFallbackRawAiOutput = contentRaw;
    debugInfo.contentFallbackNormalizedOutput = contentText;

    if (contentText === "NO_DYNAMIC_FOLLOWUP") {
      debugInfo.contentFallbackValidationReason =
        "content_returned_no_dynamic_followup";
      debugInfo.contentFallbackUsed = false;
      devLog(
        "[dynamic-followup:POST] content fallback also returned NO_DYNAMIC_FOLLOWUP",
        { sessionId },
      );
      return null;
    }

    const validationReason = validateFallbackFollowupText({
      text: contentText,
      transcriptText,
      regularQuestions: otherQuestions,
    });
    if (validationReason) {
      debugInfo.contentFallbackValidationReason = validationReason;
      debugInfo.contentFallbackUsed = false;
      devWarn(
        "[dynamic-followup:POST] content fallback returned invalid question",
        {
          sessionId,
          textLength: contentText.length,
          text: contentText.slice(0, 100),
        },
      );
      return null;
    }

    debugInfo.contentFallbackValidationReason = null;
    debugInfo.contentFallbackUsed = true;
    const createdQuestion = await createOrReturnDynamicQuestion({
      sessionId,
      projectId,
      questionText: contentText,
    });
    devLog(
      "[dynamic-followup:POST] content fallback created dynamic question",
      {
        sessionId,
        createdQuestionId: createdQuestion.id,
        orderIndex: createdQuestion.orderIndex,
        textLength: contentText.length,
        questionText: contentText,
      },
    );
    debugInfo.usedStage = "content";
    return createdQuestion;
  } catch (contentError) {
    debugInfo.contentFallbackError = String(contentError);
    devWarn(
      "[dynamic-followup:POST] content fallback error, attempting retry",
      {
        sessionId,
        error: String(contentError),
      },
    );
    return attemptContentFallbackRetry(input, debugInfo);
  }
}

async function handleRejectedMainOutput(
  input: PreparedDynamicFollowupInput,
  debugInfo: DynamicFollowupDebugInfo,
  rawAiOutput: string,
  followupText: string,
  validationReason: string,
): Promise<DynamicFollowupGenerationResult> {
  const { sessionId, transcriptText } = input;

  if (followupText === "NO_DYNAMIC_FOLLOWUP") {
    devLog("[dynamic-followup:POST] AI returned NO_DYNAMIC_FOLLOWUP", {
      sessionId,
    });
  } else {
    devWarn("[dynamic-followup:POST] main output rejected", {
      sessionId,
      reason: validationReason,
      text: followupText.slice(0, 100),
    });
  }
  debugInfo.pitchTextLength = transcriptText.length;
  debugInfo.pitchTextPreview = transcriptText.slice(0, 200);
  debugInfo.rawAiOutput = rawAiOutput;
  debugInfo.normalizedAiOutput = followupText;
  debugInfo.validationReason = validationReason;

  if (SHOULD_ATTEMPT_MISMATCH_FALLBACK) {
    const mismatchQuestion = await attemptMismatchFallback(input, debugInfo);
    if (mismatchQuestion) {
      return { kind: "created", question: mismatchQuestion };
    }
  }

  const contentQuestion = await attemptContentFallback(input, debugInfo);
  return contentQuestion
    ? { kind: "created", question: contentQuestion }
    : { kind: "skipped", reason: "no_dynamic_followup" };
}

export async function generateDynamicFollowup(
  input: PreparedDynamicFollowupInput,
  debugInfo: DynamicFollowupDebugInfo,
): Promise<DynamicFollowupGenerationResult> {
  const { sessionId, projectId, transcriptText, otherQuestions } = input;
  const followupResult = await callMainDynamicFollowup({
    transcript: input.pitchTranscriptText,
    aiContext: input.aiContext,
    existingQuestions: input.otherQuestionsText,
  });

  const rawAiOutput = followupResult.text;
  const followupText = rawAiOutput.trim();
  let acceptedFollowupText = followupText;
  let mainValidationReason =
    followupText === "NO_DYNAMIC_FOLLOWUP"
      ? "ai_returned_no_dynamic_followup"
      : validateMainFollowupText({
          text: followupText,
          transcriptText,
          regularQuestions: otherQuestions,
        });

  if (mainValidationReason === "main_output_multiple_questions") {
    const normalizedFollowupText =
      normalizeMainMultipleQuestionText(followupText);
    const normalizedValidationReason = normalizedFollowupText
      ? validateMainFollowupText({
          text: normalizedFollowupText,
          transcriptText,
          regularQuestions: otherQuestions,
        })
      : "main_output_multiple_questions";

    if (normalizedFollowupText && !normalizedValidationReason) {
      acceptedFollowupText = normalizedFollowupText;
      mainValidationReason = null;
      debugInfo.rawAiOutput = rawAiOutput;
      debugInfo.normalizedAiOutput = normalizedFollowupText;
      devLog("[dynamic-followup:POST] normalized main followup question", {
        sessionId,
        rawQuestionText: followupText,
        questionText: normalizedFollowupText,
      });
    }
  }

  if (mainValidationReason) {
    return handleRejectedMainOutput(
      input,
      debugInfo,
      rawAiOutput,
      followupText,
      mainValidationReason,
    );
  }

  const validationReason =
    getBasicQuestionValidationReason(acceptedFollowupText);
  if (validationReason) {
    devWarn("[dynamic-followup:POST] AI returned invalid question", {
      sessionId,
      textLength: acceptedFollowupText.length,
      text: acceptedFollowupText.slice(0, 100),
    });
    debugInfo.pitchTextLength = transcriptText.length;
    debugInfo.pitchTextPreview = transcriptText.slice(0, 200);
    debugInfo.rawAiOutput = rawAiOutput;
    debugInfo.normalizedAiOutput = acceptedFollowupText;
    debugInfo.validationReason = validationReason;
    return { kind: "skipped", reason: "ai_generation_failed" };
  }

  const createdQuestion = await createOrReturnDynamicQuestion({
    sessionId,
    projectId,
    questionText: acceptedFollowupText,
  });

  devLog("[dynamic-followup:POST] dynamic followup created", {
    sessionId,
    createdQuestionId: createdQuestion.id,
    orderIndex: createdQuestion.orderIndex,
    textLength: acceptedFollowupText.length,
    questionText: acceptedFollowupText,
  });

  debugInfo.usedStage = "main";
  return { kind: "created", question: createdQuestion };
}
