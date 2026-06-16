import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { callAI } from "@/lib/ai";
import { buildProjectAIContext } from "@/lib/project-context";
import { loadPromptTemplate } from "@/lib/prompt-loader";
import { renderPrompt } from "@/lib/prompt-renderer";
import { devLog, devWarn } from "@/lib/dev-log";

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
  usedStage?: "main" | "mismatch" | "content";
}

const DYNAMIC_FOLLOWUP_ORDER_INDEX = 4;
const DYNAMIC_FOLLOWUP_SOURCE = "DYNAMIC_FOLLOWUP";
const DYNAMIC_FOLLOWUP_TYPE = "FOLLOWUP";
const DYNAMIC_FOLLOWUP_BASIS = "基于本轮 Pitch 转写生成的动态追问";

const dynamicQuestionSelect = {
  id: true,
  orderIndex: true,
  questionText: true,
  questionType: true,
  source: true,
  basis: true,
  answer: {
    select: {
      id: true,
      answerText: true,
      revealedQuestionText: true,
      startedAt: true,
      endedAt: true,
      durationSec: true,
    },
  },
} as const;

function serializeDynamicQuestion(
  question: Awaited<ReturnType<typeof findExistingDynamicQuestion>>,
) {
  if (!question) {
    return null;
  }

  return {
    id: question.id,
    orderIndex: question.orderIndex,
    questionText: question.questionText,
    questionType: question.questionType,
    source: question.source,
    basis: question.basis,
    answer: question.answer
      ? {
          id: question.answer.id,
          answerText: question.answer.answerText,
          revealedQuestionText: question.answer.revealedQuestionText,
          startedAt: question.answer.startedAt?.toISOString() ?? null,
          endedAt: question.answer.endedAt?.toISOString() ?? null,
          durationSec: question.answer.durationSec,
        }
      : null,
  };
}

async function findExistingDynamicQuestion(sessionId: string) {
  return prisma.trainingQuestion.findFirst({
    where: {
      sessionId,
      orderIndex: DYNAMIC_FOLLOWUP_ORDER_INDEX,
      source: DYNAMIC_FOLLOWUP_SOURCE,
    },
    select: dynamicQuestionSelect,
  });
}

export async function POST(
  request: NextRequest,
  context: DynamicFollowupContext,
) {
  const { sessionId } = await context.params;

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

    const debug = body.debug === true;
    const protectedQuestionIds: string[] = body.protectedQuestionIds ?? [];
    const minReplaceableOrderIndex = body.minReplaceableOrderIndex ?? 1;

    const debugInfo: DebugInfo = {};

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

    function buildSuccessResponse(question: NonNullable<ReturnType<typeof serializeDynamicQuestion>>) {
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
      select: { id: true, projectId: true },
    });

    if (!session) {
      devLog("[dynamic-followup:POST] session not found", { sessionId });
      return NextResponse.json(
        { error: "训练场次不存在。" },
        { status: 404 },
      );
    }

    async function createOrReturnDynamicQuestion(questionText: string) {
      const existingQuestion = await findExistingDynamicQuestion(sessionId);
      const serializedExistingQuestion =
        serializeDynamicQuestion(existingQuestion);

      if (serializedExistingQuestion) {
        return serializedExistingQuestion;
      }

      try {
        const createdQuestion = await prisma.trainingQuestion.create({
          data: {
            sessionId,
            projectId: session.projectId,
            orderIndex: DYNAMIC_FOLLOWUP_ORDER_INDEX,
            questionText,
            questionType: DYNAMIC_FOLLOWUP_TYPE,
            source: DYNAMIC_FOLLOWUP_SOURCE,
            basis: DYNAMIC_FOLLOWUP_BASIS,
          },
          select: dynamicQuestionSelect,
        });

        const serializedCreatedQuestion =
          serializeDynamicQuestion(createdQuestion);

        if (serializedCreatedQuestion) {
          return serializedCreatedQuestion;
        }
      } catch (error) {
        const fallbackQuestion = await findExistingDynamicQuestion(sessionId);
        const serializedFallbackQuestion =
          serializeDynamicQuestion(fallbackQuestion);

        if (serializedFallbackQuestion) {
          return serializedFallbackQuestion;
        }

        throw error;
      }

      throw new Error("dynamic followup question create failed");
    }

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
      aiContext = await buildProjectAIContext(session.projectId);
    } catch {
      devLog("[dynamic-followup:POST] project context not found, using minimal", {
        sessionId,
      });
      aiContext = null;
    }

    // 填充项目上下文 debug 信息
    const projectName = aiContext?.project?.name ?? null;
    const projectContextText = [
      projectName ?? "",
      aiContext?.project?.description ?? "",
      ...(aiContext?.files ?? []).map((f) => f.extractedText ?? ""),
    ]
      .filter(Boolean)
      .join("\n");
    debugInfo.hasProjectContext = projectContextText.length > 0;
    debugInfo.projectTitle = projectName;
    debugInfo.projectContextLength = projectContextText.length;
    debugInfo.projectContextPreview = projectContextText.slice(0, 200);

    // 生成动态追问
    const followupTemplate = await loadPromptTemplate("dynamic-followup");

    const followupPrompt = renderPrompt(followupTemplate, {
      transcript: pitchTranscript.text,
      project: aiContext?.project ?? null,
      files: aiContext?.files ?? [],
      evaluationRule: aiContext?.evaluationRule ?? "",
      criteria: aiContext?.criteria ?? [],
      existingQuestions: otherQuestionsText,
    });

    debugInfo.promptInputSummary = {
      hasPitchText: transcriptText.length > 0,
      hasProjectContext: projectContextText.length > 0,
      hasRegularQuestions: otherQuestionsText.length > 0,
      hasEvaluationRules:
        (aiContext?.evaluationRule ?? "").length > 0 ||
        (aiContext?.criteria ?? []).length > 0,
    };

    const followupResult = await callAI({
      systemPrompt: "你是一名专业路演答辩评委，只输出一个问题。",
      userPrompt: followupPrompt,
      temperature: 0.3,
      maxOutputTokens: 500,
    });

    const MIN_QUESTION_LENGTH = 10;
    const MAX_QUESTION_LENGTH = 200;

    function validateQuestionText(
      text: string,
    ): string | null {
      if (!text) return "output_empty";
      if (text.length < MIN_QUESTION_LENGTH) return "output_too_short";
      if (text.length > MAX_QUESTION_LENGTH) return "output_too_long";
      if (!text.includes("?") && !text.includes("？")) return "output_not_question";
      return null;
    }

    function isMismatchStyleQuestion(text: string) {
      return (
        text.includes("材料里写") ||
        text.includes("提交的是") ||
        text.includes("刚才主要讲") ||
        text.includes("主要讲到了") ||
        text.includes("跨度") ||
        text.includes("偏离了提交项目") ||
        text.includes("本轮路演内容") ||
        text.includes("现场讲述和项目材料")
      );
    }

    function countQuestionMarks(text: string) {
      return (text.match(/[?？]/g) ?? []).length;
    }

    function hasContextLeak(text: string) {
      const upperText = text.toUpperCase();
      const contextLeakMarkers = [
        "Project:",
        "已有问题",
        "-- 1 of",
        "输出要求",
        "Pitch 转写",
      ];

      return (
        upperText.includes("TRAINING SYSTEM") ||
        contextLeakMarkers.some((marker) => text.includes(marker))
      );
    }

    function normalizeQuestionForOverlap(text: string) {
      return text
        .trim()
        .replace(/\s+/g, "")
        .replace(/[?？。,.，、：:；;"“”'‘’]/g, "");
    }

    function duplicatesRegularQuestion(
      text: string,
      regularQuestions: typeof otherQuestions,
    ) {
      const normalizedText = normalizeQuestionForOverlap(text);

      if (!normalizedText) {
        return false;
      }

      return regularQuestions.some((question) => {
        const normalizedQuestion = normalizeQuestionForOverlap(
          question.questionText,
        );

        if (!normalizedQuestion) {
          return false;
        }

        const prefix = normalizedQuestion.slice(0, 20);

        return (
          normalizedText.includes(normalizedQuestion) ||
          normalizedQuestion.includes(normalizedText) ||
          (prefix.length >= 12 && normalizedText.includes(prefix))
        );
      });
    }

    function validateMainFollowupText(text: string) {
      if (isMismatchStyleQuestion(text)) return "main_output_mismatch_style";
      if (text.length > 180) return "main_output_too_long";
      if (hasContextLeak(text)) return "main_output_context_leak";
      if (countQuestionMarks(text) > 1) return "main_output_multiple_questions";
      if (duplicatesRegularQuestion(text, otherQuestions)) {
        return "main_output_duplicate_regular_question";
      }

      return validateQuestionText(text);
    }

    const rawAiOutput = followupResult.text;
    const followupText = rawAiOutput.trim();
    const mainValidationReason =
      followupText === "NO_DYNAMIC_FOLLOWUP"
        ? "ai_returned_no_dynamic_followup"
        : validateMainFollowupText(followupText);

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
      const hasProjectCtx = projectContextText.length > 0;
      if (hasProjectCtx) {
        debugInfo.fallbackAttempted = true;
        try {
          devLog("[dynamic-followup:POST] attempting mismatch fallback", {
            sessionId,
          });
          const mismatchTemplate = await loadPromptTemplate(
            "dynamic-followup-mismatch",
          );
          const mismatchPrompt = renderPrompt(mismatchTemplate, {
            projectTitle: projectName ?? "",
            projectContext: projectContextText.slice(0, 2000),
            pitchTranscript: transcriptText,
          });
          const mismatchResult = await callAI({
            systemPrompt:
              "你是一名专业路演答辩评委，只输出一个问题或 NO_DYNAMIC_FOLLOWUP。",
            userPrompt: mismatchPrompt,
            temperature: 0.3,
            maxOutputTokens: 500,
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
            fallbackText.length < MIN_QUESTION_LENGTH ||
            fallbackText.length > MAX_QUESTION_LENGTH ||
            (!fallbackText.includes("?") && !fallbackText.includes("？"))
          ) {
            let fbReason = "fallback_output_not_question";
            if (!fallbackText) fbReason = "fallback_output_empty";
            else if (fallbackText.length < MIN_QUESTION_LENGTH)
              fbReason = "fallback_output_too_short";
            else if (fallbackText.length > MAX_QUESTION_LENGTH)
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
              await createOrReturnDynamicQuestion(fallbackText);
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
      const PROJECT_CONTENT_KEYWORDS = [
        "项目",
        "系统",
        "产品",
        "平台",
        "模块",
        "已完成",
        "原型",
        "测试",
        "试用",
        "客户",
        "用户",
        "商业模式",
        "落地",
        "数据",
        "指标",
        "验证",
        "动态追问",
        "自动转写",
        "模拟答辩",
        "训练报告",
        "没有讲透",
        "证据支撑",
      ];
      const matchedKeywords = PROJECT_CONTENT_KEYWORDS.filter((kw) =>
        transcriptText.includes(kw),
      );
      const hasPitchProjectContent = matchedKeywords.length > 0;
      debugInfo.hasPitchProjectContent = hasPitchProjectContent;
      debugInfo.pitchProjectContentMatchedKeywords = matchedKeywords;

      const MIN_CONTENT_PITCH_CHARS = 120;
      if (
        transcriptText.length >= MIN_CONTENT_PITCH_CHARS &&
        hasPitchProjectContent
      ) {
        debugInfo.contentFallbackAttempted = true;
        try {
          devLog("[dynamic-followup:POST] attempting content fallback", {
            sessionId,
          });
          const contentTemplate = await loadPromptTemplate(
            "dynamic-followup-content",
          );
          const contentPrompt = renderPrompt(contentTemplate, {
            projectTitle: projectName ?? "",
            projectContext: projectContextText.slice(0, 2000),
            pitchTranscript: transcriptText,
            existingQuestions: otherQuestionsText,
          });
          const contentResult = await callAI({
            systemPrompt:
              "你是一名专业路演答辩评委，只输出一个问题。",
            userPrompt: contentPrompt,
            temperature: 0.3,
            maxOutputTokens: 500,
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
            const validationReason = validateQuestionText(contentText);
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
                await createOrReturnDynamicQuestion(contentText);
              devLog(
                "[dynamic-followup:POST] content fallback created dynamic question",
                {
                  sessionId,
                  createdQuestionId: createdQuestion.id,
                  orderIndex: createdQuestion.orderIndex,
                  textLength: contentText.length,
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
4. 不要输出 NO_DYNAMIC_FOLLOWUP；
5. 问题不超过 100 字；
6. 优先追问“讲到了但没有讲透”的点，例如验证方式、数据指标、落地计划、用户反馈、商业模式。

项目标题：
${projectName ?? ""}

路演转写：
${transcriptText.slice(0, 1200)}

已有问题，避免完全重复：
${otherQuestionsText.slice(0, 800)}`;

            const retryResult = await callAI({
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
              const retryValidationReason = validateQuestionText(retryText);
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
                  await createOrReturnDynamicQuestion(retryText);
                devLog(
                  "[dynamic-followup:POST] content fallback retry created dynamic question",
                  {
                    sessionId,
                    createdQuestionId: createdQuestion.id,
                    orderIndex: createdQuestion.orderIndex,
                    textLength: retryText.length,
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
        buildDebugResponse({ reason: "no_supported_followup" }),
      );
    }

    // 校验 AI 返回结果
    if (
      !followupText ||
      followupText.length < MIN_QUESTION_LENGTH ||
      followupText.length > MAX_QUESTION_LENGTH ||
      (!followupText.includes("?") && !followupText.includes("？"))
    ) {
      let validationReason = "output_not_question";
      if (!followupText) {
        validationReason = "output_empty";
      } else if (followupText.length < MIN_QUESTION_LENGTH) {
        validationReason = "output_too_short";
      } else if (followupText.length > MAX_QUESTION_LENGTH) {
        validationReason = "output_too_long";
      }
      devWarn("[dynamic-followup:POST] AI returned invalid question", {
        sessionId,
        textLength: followupText.length,
        text: followupText.slice(0, 100),
      });
      debugInfo.pitchTextLength = transcriptText.length;
      debugInfo.pitchTextPreview = transcriptText.slice(0, 200);
      debugInfo.rawAiOutput = rawAiOutput;
      debugInfo.normalizedAiOutput = followupText;
      debugInfo.validationReason = validationReason;
      return NextResponse.json(
        buildDebugResponse({ reason: "ai_generation_failed" }),
      );
    }

    const createdQuestion = await createOrReturnDynamicQuestion(followupText);

    devLog("[dynamic-followup:POST] dynamic followup created", {
      sessionId,
      createdQuestionId: createdQuestion.id,
      orderIndex: createdQuestion.orderIndex,
      textLength: followupText.length,
    });

    debugInfo.usedStage = "main";
    return NextResponse.json(
      buildSuccessResponse(createdQuestion),
    );
  } catch (error) {
    devWarn("[dynamic-followup:POST] unexpected error", {
      sessionId,
      error: String(error),
    });
    debugInfo.validationReason = "unexpected_error";
    return NextResponse.json(
      buildDebugResponse({ reason: "ai_generation_failed" }),
    );
  }
}
