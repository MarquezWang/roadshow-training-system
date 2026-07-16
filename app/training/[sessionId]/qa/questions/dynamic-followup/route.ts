import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { callAI } from "@/lib/ai";
import {
  buildProjectAIContext,
  parseProjectAIContextSnapshot,
} from "@/lib/project-context";
import { devLog, devWarn } from "@/lib/dev-log";
import { isSessionOwnedByCurrentUser } from "@/lib/auth-server";
import {
  createOrReturnDynamicQuestion,
  DynamicFollowupSessionClosedError,
  DYNAMIC_FOLLOWUP_SOURCE,
  findExistingDynamicQuestion,
  serializeDynamicQuestion,
  type SerializedDynamicQuestion,
} from "@/lib/dynamic-followup-question";
import { dynamicQuestionTrainingStatuses } from "@/lib/training-status";
import { acquireAsyncJob, releaseAsyncJob } from "@/lib/async-job";
import {
  buildDynamicFollowupProjectContext,
  evaluateDynamicFollowupPreflight,
} from "@/lib/dynamic-followup-context";
import {
  callContentDynamicFollowup,
  callMainDynamicFollowup,
  callMismatchDynamicFollowup,
} from "@/lib/dynamic-followup-ai";
import { evaluateContentFallbackEligibility } from "@/lib/dynamic-followup-fallback";
import {
  MAX_DYNAMIC_FOLLOWUP_QUESTION_LENGTH,
  MIN_DYNAMIC_FOLLOWUP_QUESTION_LENGTH,
  normalizeMainMultipleQuestionText,
  validateFallbackFollowupText,
  validateMainFollowupText,
} from "@/lib/dynamic-followup-validation";

type DynamicFollowupContext = Readonly<{
  params: Promise<{
    sessionId: string;
  }>;
}>;

interface DynamicFollowupBody {
  protectedQuestionIds?: string[];
  minReplaceableOrderIndex?: number;
  debug?: boolean;
}

interface DebugInfo {
  pitchTextLength?: number;
  pitchTextPreview?: string;
  rawAiOutput?: string;
  normalizedAiOutput?: string;
  validationReason?: string;
  hasProjectContext?: boolean;
  projectTitle?: string | null;
  projectContextLength?: number;
  projectContextPreview?: string;
  regularQuestionsCount?: number;
  regularQuestionsPreview?: string[];
  promptInputSummary?: {
    hasPitchText: boolean;
    hasProjectContext: boolean;
    hasRegularQuestions: boolean;
    hasEvaluationRules: boolean;
  };
  fallbackAttempted?: boolean;
  fallbackRawAiOutput?: string | null;
  fallbackNormalizedOutput?: string | null;
  fallbackValidationReason?: string | null;
  fallbackUsed?: boolean;
  contentFallbackAttempted?: boolean;
  contentFallbackRawAiOutput?: string | null;
  contentFallbackNormalizedOutput?: string | null;
  contentFallbackValidationReason?: string | null;
  contentFallbackUsed?: boolean;
  contentFallbackRetryAttempted?: boolean;
  contentFallbackRetryRawAiOutput?: string | null;
  contentFallbackRetryNormalizedOutput?: string | null;
  contentFallbackRetryValidationReason?: string | null;
  contentFallbackRetryUsed?: boolean;
  contentFallbackError?: string | null;
  otherQuestionsCount?: number;
  otherQuestionsPreview?: string[];
  hasPitchProjectContent?: boolean;
  pitchProjectContentMatchedKeywords?: string[];
  transcriptProjectSignalCount?: number;
  matchedProjectSignals?: string[];
  hasProjectNameInTranscript?: boolean;
  hasSparseProjectContext?: boolean;
  preflightSkippedReason?: string;
  usedStage?: "main" | "mismatch" | "content";
}

const dynamicFollowupJobKey = (sessionId: string) =>
  `dynamic-followup:${sessionId}`;

export async function POST(
  request: NextRequest,
  context: DynamicFollowupContext,
) {
  const { sessionId } = await context.params;
  if (!(await isSessionOwnedByCurrentUser(sessionId))) {
    return NextResponse.json({ error: "Session not found" }, { status: 404 });
  }
  const debugInfo: DebugInfo = {};
  let debug = false;
  let hasGenerationLock = false;
  let jobOwnerToken: string | null = null;
  let jobFailed = false;

  try {
    // 实验开关
    if (process.env.DYNAMIC_FOLLOWUP_EXPERIMENT !== "true") {
      devLog("[dynamic-followup:POST] experiment disabled", { sessionId });
      return NextResponse.json({
        ok: false,
        skipped: true,
        reason: "experiment_disabled",
      });
    }

    // 解析 body
    let body: DynamicFollowupBody = {};
    try {
      body = (await request.json()) as DynamicFollowupBody;
    } catch {
      // body 为空时使用默认值
    }

    debug = body.debug === true;
    const protectedQuestionIds: string[] = body.protectedQuestionIds ?? [];
    const minReplaceableOrderIndex = body.minReplaceableOrderIndex ?? 1;

    function buildDebugResponse(props: {
      skipped?: boolean;
      reason?: string;
      error?: string;
    }) {
      const base = { ok: false, skipped: true, ...props };
      if (debug) {
        return { ...base, debug: debugInfo };
      }
      return base;
    }

    function buildSkippedSuccessResponse(reason: string) {
      const base = { ok: true, skipped: true, reason };
      if (debug) {
        return { ...base, debug: debugInfo };
      }
      return base;
    }

    function buildSuccessResponse(question: SerializedDynamicQuestion) {
      const base = {
        ok: true,
        createdQuestion: question,
        createdQuestionId: question.id,
        orderIndex: question.orderIndex,
        questionText: question.questionText,
        source: question.source,
      };
      if (debug) {
        return { ...base, debug: debugInfo };
      }
      return base;
    }

    // 校验 session
    const session = await prisma.trainingSession.findUnique({
      where: { id: sessionId },
      select: {
        id: true,
        projectId: true,
        status: true,
        projectContextSnapshot: true,
      },
    });

    if (!session) {
      devLog("[dynamic-followup:POST] session not found", { sessionId });
      return NextResponse.json(
        { error: "训练场次不存在。" },
        { status: 404 },
      );
    }

    const projectId = session.projectId;

    const existingDynamicQuestion = await findExistingDynamicQuestion(sessionId);
    const serializedExistingDynamicQuestion = serializeDynamicQuestion(
      existingDynamicQuestion,
    );

    if (serializedExistingDynamicQuestion) {
      devLog("[dynamic-followup:POST] dynamic followup already exists", {
        sessionId,
        createdQuestionId: serializedExistingDynamicQuestion.id,
        orderIndex: serializedExistingDynamicQuestion.orderIndex,
      });
      debugInfo.usedStage = "main";
      return NextResponse.json(
        buildSuccessResponse(serializedExistingDynamicQuestion),
      );
    }

    // 查询 Pitch 转写
    const acquiredJob = await acquireAsyncJob({
      jobKey: dynamicFollowupJobKey(sessionId),
      jobType: "DYNAMIC_FOLLOWUP",
      resourceId: sessionId,
      leaseMs: 10 * 60_000,
    });
    if (!acquiredJob) {
      devLog("[dynamic-followup:POST] dynamic followup already in progress", {
        sessionId,
      });
      return NextResponse.json(
        buildDebugResponse({ reason: "dynamic_followup_in_progress" }),
      );
    }

    jobOwnerToken = acquiredJob.ownerToken;
    hasGenerationLock = true;

    const pitchTranscript = await prisma.trainingTranscript.findFirst({
      where: {
        sessionId,
        status: "COMPLETED",
        text: { not: "" },
        recording: { phase: "PITCH" },
      },
      orderBy: { updatedAt: "desc" },
      select: {
        id: true,
        text: true,
        status: true,
      },
    });

    if (!pitchTranscript) {
      devLog(
        "[dynamic-followup:POST] pitch transcript not ready",
        { sessionId },
      );
      debugInfo.validationReason = "pitch_transcript_not_ready";
      return NextResponse.json(
        buildDebugResponse({ reason: "pitch_transcript_not_ready" }),
      );
    }

    // Pitch 转写文本过短，不足以生成有意义的追问
    const MIN_TRANSCRIPT_CHARS = 80;
    const transcriptText = pitchTranscript.text.trim();
    if (transcriptText.length < MIN_TRANSCRIPT_CHARS) {
      devLog(
        "[dynamic-followup:POST] pitch transcript too short",
        { sessionId, textLength: transcriptText.length },
      );
      debugInfo.pitchTextLength = transcriptText.length;
      debugInfo.pitchTextPreview = transcriptText.slice(0, 200);
      debugInfo.validationReason = "pitch_transcript_too_short";
      return NextResponse.json(
        buildDebugResponse({ reason: "pitch_transcript_too_short" }),
      );
    }

    // 查询当前 QA 问题
    const questions = await prisma.trainingQuestion.findMany({
      where: { sessionId },
      orderBy: { orderIndex: "asc" },
      include: {
        answer: {
          select: { id: true },
        },
      },
    });

    if (questions.length === 0) {
      devLog("[dynamic-followup:POST] no questions found", { sessionId });
      debugInfo.validationReason = "no_base_questions";
      debugInfo.regularQuestionsCount = 0;
      debugInfo.regularQuestionsPreview = [];
      return NextResponse.json(
        buildDebugResponse({ reason: "no_base_questions" }),
      );
    }

    debugInfo.regularQuestionsCount = questions.length;
    debugInfo.regularQuestionsPreview = questions.slice(0, 3).map((q) =>
      q.questionText.length > 100
        ? q.questionText.slice(0, 100) + "..."
        : q.questionText
    );

    // 旧参数仅保留兼容；本阶段动态追问改为追加 Q4，不再选择替换目标。
    devLog("[dynamic-followup:POST] generating dynamic followup append", {
      sessionId,
      questionsCount: questions.length,
      legacyProtectedCount: protectedQuestionIds.length,
      legacyMinReplaceableOrderIndex: minReplaceableOrderIndex,
    });

    const otherQuestions = questions.filter(
      (q) => q.source !== DYNAMIC_FOLLOWUP_SOURCE,
    );
    const otherQuestionsText = otherQuestions
      .map((q) => `第${q.orderIndex}题：${q.questionText}`)
      .join("\n");

    debugInfo.otherQuestionsCount = otherQuestions.length;
    debugInfo.otherQuestionsPreview = otherQuestions.slice(0, 3).map((q) =>
      q.questionText.length > 100
        ? q.questionText.slice(0, 100) + "..."
        : q.questionText
    );

    let aiContext;
    try {
      aiContext =
        parseProjectAIContextSnapshot(session.projectContextSnapshot) ??
        (await buildProjectAIContext(projectId));
    } catch {
      devLog("[dynamic-followup:POST] project context not found, using minimal", {
        sessionId,
      });
      aiContext = null;
    }

    if (
      !dynamicQuestionTrainingStatuses.includes(
        session.status as (typeof dynamicQuestionTrainingStatuses)[number],
      )
    ) {
      return NextResponse.json(
        buildDebugResponse({ reason: "session_not_open_for_followup" }),
        { status: 409 },
      );
    }

    // 填充项目上下文 debug 信息
    const { projectName, projectDetailText, projectContextText } =
      buildDynamicFollowupProjectContext(aiContext);
    debugInfo.hasProjectContext = projectContextText.length > 0;
    debugInfo.projectTitle = projectName;
    debugInfo.projectContextLength = projectContextText.length;
    debugInfo.projectContextPreview = projectContextText.slice(0, 200);

    const {
      pitchProjectContent,
      hasSparseProjectContext,
      isClearlyUnrelatedPitch,
      shouldSkip,
    } = evaluateDynamicFollowupPreflight({
      aiContext,
      projectDetailText,
      projectName,
      transcriptText,
    });

    debugInfo.transcriptProjectSignalCount =
      pitchProjectContent.matchedProjectSignals.length;
    debugInfo.matchedProjectSignals =
      pitchProjectContent.matchedProjectSignals;
    debugInfo.hasProjectNameInTranscript =
      pitchProjectContent.hasProjectNameInTranscript;
    debugInfo.hasSparseProjectContext = hasSparseProjectContext;

    devLog("[dynamic-followup:POST] preflight project content check", {
      sessionId,
      transcriptProjectSignalCount:
        pitchProjectContent.matchedProjectSignals.length,
      matchedProjectSignals: pitchProjectContent.matchedProjectSignals,
      hasProjectNameInTranscript:
        pitchProjectContent.hasProjectNameInTranscript,
      hasSparseProjectContext,
      hasEnoughProjectPitchContent:
        pitchProjectContent.hasEnoughProjectPitchContent,
      isClearlyUnrelatedPitch,
    });

    if (shouldSkip) {
      const reason = "insufficient_project_pitch_content";
      debugInfo.pitchTextLength = transcriptText.length;
      debugInfo.pitchTextPreview = transcriptText.slice(0, 200);
      debugInfo.validationReason = reason;
      debugInfo.preflightSkippedReason = reason;
      devLog("[dynamic-followup:POST] skipped by preflight", {
        sessionId,
        reason,
        transcriptProjectSignalCount:
          pitchProjectContent.matchedProjectSignals.length,
        matchedProjectSignals: pitchProjectContent.matchedProjectSignals,
        hasProjectNameInTranscript:
          pitchProjectContent.hasProjectNameInTranscript,
        hasSparseProjectContext,
      });
      return NextResponse.json(buildSkippedSuccessResponse(reason));
    }

    // 生成动态追问
    debugInfo.promptInputSummary = {
      hasPitchText: transcriptText.length > 0,
      hasProjectContext: projectContextText.length > 0,
      hasRegularQuestions: otherQuestionsText.length > 0,
      hasEvaluationRules:
        Boolean(aiContext?.evaluationRule) ||
        (aiContext?.criteria ?? []).length > 0,
    };

    const followupResult = await callMainDynamicFollowup({
      transcript: pitchTranscript.text,
      aiContext,
      existingQuestions: otherQuestionsText,
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

    // AI 明确表示无法生成合格追问，或 main 输出不适合直接入库
    if (mainValidationReason) {
      if (followupText === "NO_DYNAMIC_FOLLOWUP") {
        devLog(
          "[dynamic-followup:POST] AI returned NO_DYNAMIC_FOLLOWUP",
          { sessionId },
        );
      } else {
        devWarn("[dynamic-followup:POST] main output rejected", {
          sessionId,
          reason: mainValidationReason,
          text: followupText.slice(0, 100),
        });
      }
      debugInfo.pitchTextLength = transcriptText.length;
      debugInfo.pitchTextPreview = transcriptText.slice(0, 200);
      debugInfo.rawAiOutput = rawAiOutput;
      debugInfo.normalizedAiOutput = followupText;
      debugInfo.validationReason = mainValidationReason;

      // 兜底：有项目上下文时，尝试 mismatch fallback
      const hasProjectCtx = false;
      if (hasProjectCtx) {
        debugInfo.fallbackAttempted = true;
        try {
          devLog("[dynamic-followup:POST] attempting mismatch fallback", {
            sessionId,
          });
          const mismatchResult = await callMismatchDynamicFollowup({
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
          } else if (
            !fallbackText ||
            fallbackText.length < MIN_DYNAMIC_FOLLOWUP_QUESTION_LENGTH ||
            fallbackText.length > MAX_DYNAMIC_FOLLOWUP_QUESTION_LENGTH ||
            (!fallbackText.includes("?") && !fallbackText.includes("？"))
          ) {
            let fbReason = "fallback_output_not_question";
            if (!fallbackText) fbReason = "fallback_output_empty";
            else if (fallbackText.length < MIN_DYNAMIC_FOLLOWUP_QUESTION_LENGTH)
              fbReason = "fallback_output_too_short";
            else if (fallbackText.length > MAX_DYNAMIC_FOLLOWUP_QUESTION_LENGTH)
              fbReason = "fallback_output_too_long";
            debugInfo.fallbackValidationReason = fbReason;
            debugInfo.fallbackUsed = false;
            devWarn(
              "[dynamic-followup:POST] mismatch fallback returned invalid question",
              {
                sessionId,
                textLength: fallbackText.length,
                text: fallbackText.slice(0, 100),
              },
            );
          } else {
            debugInfo.fallbackValidationReason = null;
            debugInfo.fallbackUsed = true;
            const createdQuestion =
              await createOrReturnDynamicQuestion({
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
            return NextResponse.json(
              buildSuccessResponse(createdQuestion),
            );
          }
        } catch (fallbackError) {
          debugInfo.fallbackValidationReason = "fallback_error";
          debugInfo.fallbackUsed = false;
          devWarn(
            "[dynamic-followup:POST] mismatch fallback error",
            {
              sessionId,
              error: String(fallbackError),
            },
          );
        }
      }

      // 第二层兜底：mismatch 也失败，但 Pitch 有足够内容且包含项目关键词时，尝试 content fallback
      const contentFallbackEligibility =
        evaluateContentFallbackEligibility(transcriptText);
      debugInfo.hasPitchProjectContent =
        contentFallbackEligibility.hasPitchProjectContent;
      debugInfo.pitchProjectContentMatchedKeywords =
        contentFallbackEligibility.matchedKeywords;

      if (contentFallbackEligibility.shouldAttemptContentFallback) {
        debugInfo.contentFallbackAttempted = true;
        try {
          devLog("[dynamic-followup:POST] attempting content fallback", {
            sessionId,
          });
          const contentResult = await callContentDynamicFollowup({
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
          } else {
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
            } else {
              debugInfo.contentFallbackValidationReason = null;
              debugInfo.contentFallbackUsed = true;
              const createdQuestion =
                await createOrReturnDynamicQuestion({
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
              return NextResponse.json(
                buildSuccessResponse(createdQuestion),
              );
            }
          }
        } catch (contentError) {
          debugInfo.contentFallbackError = String(contentError);
          devWarn(
            "[dynamic-followup:POST] content fallback error, attempting retry",
            {
              sessionId,
              error: String(contentError),
            },
          );

          // retry: 使用更短、更聚焦的 prompt
          debugInfo.contentFallbackRetryAttempted = true;
          try {
            const retryContentPrompt = `请基于以下路演转写内容，生成 1 个评委追问。
要求：

1. 只输出问题文本；
2. 不输出解释；
3. 不输出 JSON；
4. 只能基于路演转写中明确出现的内容追问，不要引用项目材料和转写之间的差异；
5. 如果无法基于转写可靠生成追问，只输出 NO_DYNAMIC_FOLLOWUP；
6. 问题不超过 100 字；
7. 优先追问“讲到了但没有讲透”的点，例如验证方式、数据指标、落地计划、用户反馈、商业模式。

项目标题：
${projectName ?? ""}

路演转写：
${transcriptText.slice(0, 1200)}

已有问题，避免完全重复：
${otherQuestionsText.slice(0, 800)}`;

            const retryResult = await callAI({
              task: "dynamicFollowup",
              systemPrompt: "你是一名专业路演答辩评委，只输出一个问题。",
              userPrompt: retryContentPrompt,
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
              debugInfo.contentFallbackValidationReason =
                "content_fallback_error";
              debugInfo.contentFallbackUsed = false;
            } else {
              const retryValidationReason =
                validateFallbackFollowupText({
                  text: retryText,
                  transcriptText,
                  regularQuestions: otherQuestions,
                });
              if (retryValidationReason) {
                debugInfo.contentFallbackRetryValidationReason =
                  retryValidationReason;
                debugInfo.contentFallbackRetryUsed = false;
                debugInfo.contentFallbackValidationReason =
                  "content_fallback_error";
                debugInfo.contentFallbackUsed = false;
              } else {
                debugInfo.contentFallbackRetryValidationReason = null;
                debugInfo.contentFallbackRetryUsed = true;
                debugInfo.contentFallbackValidationReason = null;
                debugInfo.contentFallbackUsed = true;
                const createdQuestion =
                  await createOrReturnDynamicQuestion({
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
                return NextResponse.json(
                  buildSuccessResponse(createdQuestion),
                );
              }
            }
          } catch (retryError) {
            debugInfo.contentFallbackRetryValidationReason =
              "retry_error";
            debugInfo.contentFallbackRetryUsed = false;
            debugInfo.contentFallbackValidationReason =
              "content_fallback_error";
            debugInfo.contentFallbackUsed = false;
            devWarn(
              "[dynamic-followup:POST] content fallback retry also failed",
              {
                sessionId,
                error: String(retryError),
              },
            );
          }
        }
      }

      return NextResponse.json(
        buildDebugResponse({ reason: "no_dynamic_followup" }),
      );
    }

    // 校验 AI 返回结果
    if (
      !acceptedFollowupText ||
      acceptedFollowupText.length < MIN_DYNAMIC_FOLLOWUP_QUESTION_LENGTH ||
      acceptedFollowupText.length > MAX_DYNAMIC_FOLLOWUP_QUESTION_LENGTH ||
      (!acceptedFollowupText.includes("?") &&
        !acceptedFollowupText.includes("？"))
    ) {
      let validationReason = "output_not_question";
      if (!acceptedFollowupText) {
        validationReason = "output_empty";
      } else if (
        acceptedFollowupText.length < MIN_DYNAMIC_FOLLOWUP_QUESTION_LENGTH
      ) {
        validationReason = "output_too_short";
      } else if (
        acceptedFollowupText.length > MAX_DYNAMIC_FOLLOWUP_QUESTION_LENGTH
      ) {
        validationReason = "output_too_long";
      }
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
      return NextResponse.json(
        buildDebugResponse({ reason: "ai_generation_failed" }),
      );
    }

    const createdQuestion =
      await createOrReturnDynamicQuestion({
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
    return NextResponse.json(
      buildSuccessResponse(createdQuestion),
    );
  } catch (error) {
    if (error instanceof DynamicFollowupSessionClosedError) {
      return NextResponse.json(
        debug
          ? {
              ok: false,
              skipped: true,
              reason: "session_not_open_for_followup",
              debug: debugInfo,
            }
          : {
              ok: false,
              skipped: true,
              reason: "session_not_open_for_followup",
            },
        { status: 409 },
      );
    }

    jobFailed = true;
    devWarn("[dynamic-followup:POST] unexpected error", {
      sessionId,
      error: String(error),
    });
    debugInfo.validationReason = "unexpected_error";
    const base = {
      ok: true,
      skipped: true,
      reason: "ai_generation_failed",
    };
    return NextResponse.json(
      debug ? { ...base, debug: debugInfo } : base,
    );
  } finally {
    if (hasGenerationLock) {
      await releaseAsyncJob({
        jobKey: dynamicFollowupJobKey(sessionId),
        ownerToken: jobOwnerToken,
        status: jobFailed ? "FAILED" : "COMPLETED",
      });
    }
  }
}
