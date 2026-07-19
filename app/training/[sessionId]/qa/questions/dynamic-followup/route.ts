import { type NextRequest, NextResponse } from "next/server";
import { isSessionOwnedByCurrentUser } from "@/lib/auth-server";
import { createAIResourceLimitResponse } from "@/lib/ai-http-response";
import { readOptionalLimitedJson } from "@/lib/input-limits";
import { devLog, devWarn } from "@/lib/dev-log";
import {
  DynamicFollowupSessionClosedError,
  findExistingDynamicQuestion,
  serializeDynamicQuestion,
} from "@/lib/dynamic-followup-question";
import { prisma } from "@/lib/prisma";
import { generateDynamicFollowup } from "./dynamic-followup-generation";
import {
  acquireDynamicFollowupJob,
  releaseDynamicFollowupJob,
} from "./dynamic-followup-job";
import { prepareDynamicFollowupGeneration } from "./dynamic-followup-preparation";
import {
  buildDynamicFollowupDebugResponse,
  buildDynamicFollowupSkippedSuccessResponse,
  buildDynamicFollowupSuccessResponse,
  buildDynamicFollowupUnexpectedFailureResponse,
} from "./dynamic-followup-response";
import type {
  DynamicFollowupBody,
  DynamicFollowupDebugInfo,
} from "./dynamic-followup-types";

type DynamicFollowupContext = Readonly<{
  params: Promise<{
    sessionId: string;
  }>;
}>;

export async function POST(
  request: NextRequest,
  context: DynamicFollowupContext,
) {
  const { sessionId } = await context.params;
  if (!(await isSessionOwnedByCurrentUser(sessionId))) {
    return NextResponse.json({ error: "Session not found" }, { status: 404 });
  }

  const debugInfo: DynamicFollowupDebugInfo = {};
  let debug = false;
  let hasGenerationLock = false;
  let jobOwnerToken: string | null = null;
  let jobFailed = false;

  try {
    if (process.env.DYNAMIC_FOLLOWUP_EXPERIMENT !== "true") {
      devLog("[dynamic-followup:POST] experiment disabled", { sessionId });
      return NextResponse.json({
        ok: false,
        skipped: true,
        reason: "experiment_disabled",
      });
    }

    let body: DynamicFollowupBody = {};
    try {
      body = await readOptionalLimitedJson(request, {});
    } catch (error) {
      return NextResponse.json(
        { error: error instanceof Error ? error.message : "请求正文无效。" },
        { status: 400 },
      );
    }

    debug = body.debug === true;
    const protectedQuestionIds = body.protectedQuestionIds ?? [];
    const minReplaceableOrderIndex = body.minReplaceableOrderIndex ?? 1;

    const session = await prisma.trainingSession.findUnique({
      where: { id: sessionId },
      select: {
        id: true,
        projectId: true,
        status: true,
        projectContextSnapshot: true,
        contextSchemaVersion: true,
        project: {
          select: {
            ownerId: true,
          },
        },
      },
    });

    if (!session) {
      devLog("[dynamic-followup:POST] session not found", { sessionId });
      return NextResponse.json({ error: "训练场次不存在。" }, { status: 404 });
    }

    const existingDynamicQuestion =
      await findExistingDynamicQuestion(sessionId);
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
        buildDynamicFollowupSuccessResponse(
          debug,
          debugInfo,
          serializedExistingDynamicQuestion,
        ),
      );
    }

    const acquiredJob = await acquireDynamicFollowupJob(sessionId);
    if (!acquiredJob) {
      devLog("[dynamic-followup:POST] dynamic followup already in progress", {
        sessionId,
      });
      return NextResponse.json(
        buildDynamicFollowupDebugResponse(debug, debugInfo, {
          reason: "dynamic_followup_in_progress",
        }),
      );
    }

    jobOwnerToken = acquiredJob.ownerToken;
    hasGenerationLock = true;

    const preparation = await prepareDynamicFollowupGeneration({
      sessionId,
      session,
      legacyProtectedCount: protectedQuestionIds.length,
      legacyMinReplaceableOrderIndex: minReplaceableOrderIndex,
      debugInfo,
    });

    if (preparation.kind === "skipped") {
      const response = preparation.successful
        ? buildDynamicFollowupSkippedSuccessResponse(
            debug,
            debugInfo,
            preparation.reason,
          )
        : buildDynamicFollowupDebugResponse(debug, debugInfo, {
            reason: preparation.reason,
          });

      return preparation.status
        ? NextResponse.json(response, { status: preparation.status })
        : NextResponse.json(response);
    }

    const generation = await generateDynamicFollowup(
      preparation.input,
      debugInfo,
    );
    if (generation.kind === "created") {
      return NextResponse.json(
        buildDynamicFollowupSuccessResponse(
          debug,
          debugInfo,
          generation.question,
        ),
      );
    }

    return NextResponse.json(
      buildDynamicFollowupDebugResponse(debug, debugInfo, {
        reason: generation.reason,
      }),
    );
  } catch (error) {
    const resourceLimitResponse = createAIResourceLimitResponse(error);
    if (resourceLimitResponse) {
      jobFailed = true;
      return resourceLimitResponse;
    }

    if (error instanceof DynamicFollowupSessionClosedError) {
      return NextResponse.json(
        buildDynamicFollowupDebugResponse(debug, debugInfo, {
          reason: "session_not_open_for_followup",
        }),
        { status: 409 },
      );
    }

    jobFailed = true;
    devWarn("[dynamic-followup:POST] unexpected error", {
      sessionId,
      error: String(error),
    });
    debugInfo.validationReason = "unexpected_error";
    return NextResponse.json(
      buildDynamicFollowupUnexpectedFailureResponse(debug, debugInfo),
    );
  } finally {
    if (hasGenerationLock) {
      await releaseDynamicFollowupJob({
        sessionId,
        ownerToken: jobOwnerToken,
        failed: jobFailed,
      });
    }
  }
}
