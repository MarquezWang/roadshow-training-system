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
  replaceableQuestionIds?: string[];
  targetQuestionId?: string;
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
  targetQuestionText?: string | null;
  otherQuestionsCount?: number;
  otherQuestionsPreview?: string[];
  hasPitchProjectContent?: boolean;
  pitchProjectContentMatchedKeywords?: string[];
  usedStage?: "main" | "mismatch" | "content";
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

    function buildSuccessResponse(data: {
      replacedQuestionId: string;
      orderIndex: number;
      questionText: string;
      source: string;
    }) {
      const base = { ok: true, ...data };
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
      debugInfo.validationReason = "no_replaceable_question";
      debugInfo.replaceableQuestionIds = [];
      debugInfo.regularQuestionsCount = 0;
      debugInfo.regularQuestionsPreview = [];
      return NextResponse.json(
        buildDebugResponse({ reason: "no_replaceable_question" }),
      );
    }

    debugInfo.regularQuestionsCount = questions.length;
    debugInfo.regularQuestionsPreview = questions.slice(0, 3).map((q) =>
      q.questionText.length > 100
        ? q.questionText.slice(0, 100) + "..."
        : q.questionText
    );

    // 找到最早可替换问题
    const targetQuestion = questions.find((q) => {
      if (q.orderIndex < minReplaceableOrderIndex) return false;
      if (protectedQuestionIds.includes(q.id)) return false;
      if (q.answer !== null) return false;
      if (q.source === "DYNAMIC_FOLLOWUP") return false;
      return true;
    });

    if (!targetQuestion) {
      devLog("[dynamic-followup:POST] no replaceable question", {
        sessionId,
        questionsCount: questions.length,
        protectedCount: protectedQuestionIds.length,
      });
      const replaceableIds = questions
        .filter((q) => {
          if (q.orderIndex < minReplaceableOrderIndex) return false;
          if (protectedQuestionIds.includes(q.id)) return false;
          if (q.answer !== null) return false;
          if (q.source === "DYNAMIC_FOLLOWUP") return false;
          return true;
        })
        .map((q) => q.id);
      debugInfo.replaceableQuestionIds = replaceableIds;
      debugInfo.validationReason = "no_replaceable_question";
      return NextResponse.json(
        buildDebugResponse({ reason: "no_replaceable_question" }),
      );
    }

    // 构建 AI 上下文
    devLog("[dynamic-followup:POST] generating dynamic followup", {
      sessionId,
      targetQuestionId: targetQuestion.id,
      targetOrderIndex: targetQuestion.orderIndex,
    });

    // 构造 otherQuestions（排除 targetQuestion），避免目标问题本身阻止 AI 生成追问
    const otherQuestions = questions.filter((q) => q.id !== targetQuestion.id);
    const otherQuestionsText = otherQuestions
      .map((q) => `第${q.orderIndex}题：${q.questionText}`)
      .join("\n");

    debugInfo.targetQuestionText = targetQuestion.questionText;
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

    const rawAiOutput = followupResult.text;
    const followupText = rawAiOutput.trim();

    // AI 明确表示无法生成合格追问
    if (followupText === "NO_DYNAMIC_FOLLOWUP") {
      devLog(
        "[dynamic-followup:POST] AI returned NO_DYNAMIC_FOLLOWUP",
        { sessionId },
      );
      debugInfo.pitchTextLength = transcriptText.length;
      debugInfo.pitchTextPreview = transcriptText.slice(0, 200);
      debugInfo.rawAiOutput = rawAiOutput;
      debugInfo.normalizedAiOutput = followupText;
      debugInfo.validationReason = "ai_returned_no_dynamic_followup";
      debugInfo.targetQuestionId = targetQuestion.id;

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
            // fallback 生成成功，替换目标问题
            debugInfo.fallbackValidationReason = null;
            debugInfo.fallbackUsed = true;
            await prisma.trainingQuestion.update({
              where: { id: targetQuestion.id },
              data: {
                questionText: fallbackText,
                source: "DYNAMIC_FOLLOWUP",
              },
            });
            devLog(
              "[dynamic-followup:POST] mismatch fallback replaced question",
              {
                sessionId,
                replacedQuestionId: targetQuestion.id,
                orderIndex: targetQuestion.orderIndex,
                textLength: fallbackText.length,
              },
            );
            debugInfo.usedStage = "mismatch";
            return NextResponse.json(
              buildSuccessResponse({
                replacedQuestionId: targetQuestion.id,
                orderIndex: targetQuestion.orderIndex,
                questionText: fallbackText,
                source: "DYNAMIC_FOLLOWUP",
              }),
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
              "你是一名专业路演答辩评委，只输出一个问题或 NO_DYNAMIC_FOLLOWUP。",
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
          } else if (
            !contentText ||
            contentText.length < MIN_QUESTION_LENGTH ||
            contentText.length > MAX_QUESTION_LENGTH ||
            (!contentText.includes("?") && !contentText.includes("？"))
          ) {
            let cfReason = "content_output_not_question";
            if (!contentText) cfReason = "content_output_empty";
            else if (contentText.length < MIN_QUESTION_LENGTH)
              cfReason = "content_output_too_short";
            else if (contentText.length > MAX_QUESTION_LENGTH)
              cfReason = "content_output_too_long";
            debugInfo.contentFallbackValidationReason = cfReason;
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
            await prisma.trainingQuestion.update({
              where: { id: targetQuestion.id },
              data: {
                questionText: contentText,
                source: "DYNAMIC_FOLLOWUP",
              },
            });
            devLog(
              "[dynamic-followup:POST] content fallback replaced question",
              {
                sessionId,
                replacedQuestionId: targetQuestion.id,
                orderIndex: targetQuestion.orderIndex,
                textLength: contentText.length,
              },
            );
            debugInfo.usedStage = "content";
            return NextResponse.json(
              buildSuccessResponse({
                replacedQuestionId: targetQuestion.id,
                orderIndex: targetQuestion.orderIndex,
                questionText: contentText,
                source: "DYNAMIC_FOLLOWUP",
              }),
            );
          }
        } catch (contentError) {
          debugInfo.contentFallbackValidationReason = "content_fallback_error";
          debugInfo.contentFallbackUsed = false;
          devWarn(
            "[dynamic-followup:POST] content fallback error",
            {
              sessionId,
              error: String(contentError),
            },
          );
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
      debugInfo.targetQuestionId = targetQuestion.id;
      return NextResponse.json(
        buildDebugResponse({ reason: "ai_generation_failed" }),
      );
    }

    // 替换目标问题
    await prisma.trainingQuestion.update({
      where: { id: targetQuestion.id },
      data: {
        questionText: followupText,
        source: "DYNAMIC_FOLLOWUP",
      },
    });

    devLog("[dynamic-followup:POST] dynamic followup replaced", {
      sessionId,
      replacedQuestionId: targetQuestion.id,
      orderIndex: targetQuestion.orderIndex,
      textLength: followupText.length,
    });

    debugInfo.usedStage = "main";
    return NextResponse.json(
      buildSuccessResponse({
        replacedQuestionId: targetQuestion.id,
        orderIndex: targetQuestion.orderIndex,
        questionText: followupText,
        source: "DYNAMIC_FOLLOWUP",
      }),
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