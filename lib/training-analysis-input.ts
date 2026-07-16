import { createHash } from "node:crypto";
import { prisma } from "@/lib/prisma";
import { buildProjectAIContext } from "@/lib/project-context";
import {
  getTrainingAnalysisGenerationContract,
  TRAINING_ANALYSIS_INPUT_HASH_VERSION,
  TRAINING_ANALYSIS_LEGACY_VERSION,
} from "@/lib/training-analysis-version.mjs";

const PREVIOUS_INPUT_HASH_VERSION = "v2";

type AnalysisVersionRecord = Readonly<{
  id: string;
  status: string;
  inputHash: string | null;
  updatedAt: Date;
}>;

type InputHashes = Readonly<{
  current: string;
  previous: string;
  legacy: string;
}>;

function sha256(value: unknown) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

async function calculateInputHashes(
  sessionId: string,
): Promise<InputHashes | null> {
  const session = await prisma.trainingSession.findUnique({
    where: { id: sessionId },
    select: {
      id: true,
      status: true,
      pitchStartedAt: true,
      pitchEndedAt: true,
      pitchDurationSec: true,
      qaStartedAt: true,
      qaEndedAt: true,
      qaDurationSec: true,
      currentPageIndex: true,
      primaryFileId: true,
      projectContextSnapshot: true,
      project: {
        select: {
          id: true,
          name: true,
          field: true,
          stage: true,
          summary: true,
          coreTechnology: true,
          applicationScenario: true,
          businessModel: true,
          cooperationDemand: true,
          productForm: true,
          trlBasis: true,
          teamInfo: true,
          cooperationDemandDetail: true,
          needsConversionSupport: true,
          updatedAt: true,
          fileAssets: {
            where: { includeInAIContext: true },
            orderBy: { id: "asc" },
            select: {
              id: true,
              originalName: true,
              fileType: true,
              parseStatus: true,
              includeInAIContext: true,
              extractedText: true,
              updatedAt: true,
            },
          },
        },
      },
      slideEvents: {
        orderBy: [{ createdAt: "asc" }, { id: "asc" }],
        select: {
          id: true,
          fileId: true,
          pageIndex: true,
          eventType: true,
          elapsedSec: true,
          createdAt: true,
        },
      },
      recordings: {
        orderBy: { id: "asc" },
        select: {
          id: true,
          phase: true,
          durationSec: true,
          startedAt: true,
          endedAt: true,
          updatedAt: true,
          transcript: {
            select: {
              id: true,
              status: true,
              source: true,
              language: true,
              text: true,
              revision: true,
              completedAt: true,
              updatedAt: true,
            },
          },
        },
      },
      trainingQuestions: {
        orderBy: [{ orderIndex: "asc" }, { id: "asc" }],
        select: {
          id: true,
          orderIndex: true,
          questionText: true,
          questionType: true,
          source: true,
          basis: true,
          updatedAt: true,
          answer: {
            select: {
              id: true,
              recordingId: true,
              answerText: true,
              revealedQuestionText: true,
              startedAt: true,
              endedAt: true,
              durationSec: true,
              updatedAt: true,
            },
          },
        },
      },
    },
  });

  if (!session) {
    return null;
  }

  // v1 与已落库的 64 位哈希保持完全一致，用于无损升级已有报告。
  const legacySession = {
    id: session.id,
    status: session.status,
    pitchStartedAt: session.pitchStartedAt,
    pitchEndedAt: session.pitchEndedAt,
    pitchDurationSec: session.pitchDurationSec,
    qaStartedAt: session.qaStartedAt,
    qaEndedAt: session.qaEndedAt,
    qaDurationSec: session.qaDurationSec,
    currentPageIndex: session.currentPageIndex,
    primaryFileId: session.primaryFileId,
    projectContextSnapshot: session.projectContextSnapshot,
    project: {
      ...session.project,
      fileAssets: session.project.fileAssets.map((file) => ({
        id: file.id,
        originalName: file.originalName,
        fileType: file.fileType,
        parseStatus: file.parseStatus,
        includeInAIContext: file.includeInAIContext,
        updatedAt: file.updatedAt,
      })),
    },
    slideEvents: session.slideEvents,
    recordings: session.recordings.map((recording) => ({
      id: recording.id,
      phase: recording.phase,
      durationSec: recording.durationSec,
      startedAt: recording.startedAt,
      endedAt: recording.endedAt,
      updatedAt: recording.updatedAt,
      transcript: recording.transcript
        ? {
            id: recording.transcript.id,
            status: recording.transcript.status,
            source: recording.transcript.source,
            language: recording.transcript.language,
            revision: recording.transcript.revision,
            completedAt: recording.transcript.completedAt,
            updatedAt: recording.transcript.updatedAt,
          }
        : null,
    })),
    trainingQuestions: session.trainingQuestions,
  };
  const legacyCanonical = session.projectContextSnapshot
    ? {
        ...legacySession,
        project: undefined,
        projectContextSnapshot: sha256(session.projectContextSnapshot),
      }
    : legacySession;

  // v2 只包含实际送入报告分析的内容；预览状态等无关更新时间不再污染指纹。
  const currentCanonical = {
    session: {
      id: session.id,
      status: session.status,
      pitchStartedAt: session.pitchStartedAt,
      pitchEndedAt: session.pitchEndedAt,
      pitchDurationSec: session.pitchDurationSec,
      qaStartedAt: session.qaStartedAt,
      qaEndedAt: session.qaEndedAt,
      qaDurationSec: session.qaDurationSec,
      currentPageIndex: session.currentPageIndex,
      primaryFileId: session.primaryFileId,
    },
    projectContext: session.projectContextSnapshot
      ? { snapshotHash: sha256(session.projectContextSnapshot) }
      : {
          id: session.project.id,
          name: session.project.name,
          field: session.project.field,
          stage: session.project.stage,
          summary: session.project.summary,
          coreTechnology: session.project.coreTechnology,
          applicationScenario: session.project.applicationScenario,
          businessModel: session.project.businessModel,
          cooperationDemand: session.project.cooperationDemand,
          productForm: session.project.productForm,
          trlBasis: session.project.trlBasis,
          teamInfo: session.project.teamInfo,
          cooperationDemandDetail: session.project.cooperationDemandDetail,
          needsConversionSupport: session.project.needsConversionSupport,
          files: session.project.fileAssets.map((file) => ({
            id: file.id,
            originalName: file.originalName,
            fileType: file.fileType,
            parseStatus: file.parseStatus,
            includeInAIContext: file.includeInAIContext,
            extractedText: file.extractedText,
          })),
    },
    slideEvents: session.slideEvents,
    recordings: session.recordings.map((recording) => ({
      id: recording.id,
      phase: recording.phase,
      durationSec: recording.durationSec,
      startedAt: recording.startedAt,
      endedAt: recording.endedAt,
      transcript: recording.transcript
        ? {
            id: recording.transcript.id,
            status: recording.transcript.status,
            source: recording.transcript.source,
            language: recording.transcript.language,
            text: recording.transcript.text,
            revision: recording.transcript.revision,
            completedAt: recording.transcript.completedAt,
          }
        : null,
    })),
    trainingQuestions: session.trainingQuestions.map((question) => ({
        id: question.id,
        orderIndex: question.orderIndex,
        questionText: question.questionText,
        questionType: question.questionType,
        source: question.source,
        basis: question.basis,
        answer: question.answer
          ? {
              id: question.answer.id,
              recordingId: question.answer.recordingId,
              answerText: question.answer.answerText,
              revealedQuestionText: question.answer.revealedQuestionText,
              startedAt: question.answer.startedAt,
              endedAt: question.answer.endedAt,
              durationSec: question.answer.durationSec,
            }
          : null,
      })),
  };

  const generationContextHash = session.projectContextSnapshot
    ? sha256(session.projectContextSnapshot)
    : sha256(await buildProjectAIContext(session.project.id));
  const generationContract = getTrainingAnalysisGenerationContract();
  const previousHash = `${PREVIOUS_INPUT_HASH_VERSION}:${sha256(currentCanonical)}`;

  return {
    current: `${TRAINING_ANALYSIS_INPUT_HASH_VERSION}:${sha256({
      trainingInput: currentCanonical,
      generationContextHash,
      generationContract,
    })}`,
    previous: previousHash,
    legacy: sha256(legacyCanonical),
  };
}

async function findLegacyInputChangesSince(sessionId: string, since: Date) {
  const session = await prisma.trainingSession.findUnique({
    where: { id: sessionId },
    select: {
      updatedAt: true,
      projectContextSnapshot: true,
      project: {
        select: {
          updatedAt: true,
          fileAssets: {
            where: {
              includeInAIContext: true,
              createdAt: { gt: since },
            },
            select: { id: true },
            take: 1,
          },
        },
      },
      slideEvents: {
        where: { createdAt: { gt: since } },
        select: { id: true },
        take: 1,
      },
      recordings: {
        where: { updatedAt: { gt: since } },
        select: { id: true },
        take: 1,
      },
      transcripts: {
        where: { updatedAt: { gt: since } },
        select: { id: true },
        take: 1,
      },
      trainingQuestions: {
        where: { updatedAt: { gt: since } },
        select: { id: true },
        take: 1,
      },
      trainingAnswers: {
        where: { updatedAt: { gt: since } },
        select: { id: true },
        take: 1,
      },
    },
  });

  if (!session) {
    return ["session_missing"];
  }

  const changes: string[] = [];
  if (session.updatedAt > since) changes.push("session");
  if (
    !session.projectContextSnapshot &&
    session.project.updatedAt > since
  ) {
    changes.push("project");
  }
  if (
    !session.projectContextSnapshot &&
    session.project.fileAssets.length > 0
  ) {
    changes.push("material_added");
  }
  if (session.slideEvents.length > 0) changes.push("slide_event");
  if (session.recordings.length > 0) changes.push("recording");
  if (session.transcripts.length > 0) changes.push("transcript");
  if (session.trainingQuestions.length > 0) changes.push("question");
  if (session.trainingAnswers.length > 0) changes.push("answer");
  return changes;
}

export async function calculateTrainingAnalysisInputHash(sessionId: string) {
  return (await calculateInputHashes(sessionId))?.current ?? null;
}

export async function reconcileTrainingAnalysisInputVersion(
  sessionId: string,
  analysis: AnalysisVersionRecord,
) {
  const hashes = await calculateInputHashes(sessionId);
  if (!hashes || analysis.status !== "COMPLETED") {
    return {
      stale: false,
      reason: null,
      currentInputHash: hashes?.current ?? null,
      backfilled: false,
    };
  }

  if (analysis.inputHash === hashes.current) {
    return {
      stale: false,
      reason: null,
      currentInputHash: hashes.current,
      backfilled: false,
    };
  }

  // 已有 v1/v2 哈希能证明训练内容未变化；兼容升级到包含生成契约的 v3。
  if (
    analysis.inputHash &&
    (analysis.inputHash === hashes.previous ||
      analysis.inputHash === hashes.legacy)
  ) {
    const upgraded = await prisma.trainingAnalysis.updateMany({
      where: {
        id: analysis.id,
        status: "COMPLETED",
        inputHash: analysis.inputHash,
      },
      data: {
        inputHash: hashes.current,
        promptVersion: TRAINING_ANALYSIS_LEGACY_VERSION,
        schemaVersion: TRAINING_ANALYSIS_LEGACY_VERSION,
        modelVersion: TRAINING_ANALYSIS_LEGACY_VERSION,
        ruleVersion: TRAINING_ANALYSIS_LEGACY_VERSION,
      },
    });
    return {
      stale: false,
      reason: null,
      currentInputHash: hashes.current,
      backfilled: upgraded.count > 0,
    };
  }

  if (analysis.inputHash) {
    return {
      stale: true,
      reason: "analysis input hash differs from the current training input",
      currentInputHash: hashes.current,
      backfilled: false,
    };
  }

  const legacyChanges = await findLegacyInputChangesSince(
    sessionId,
    analysis.updatedAt,
  );
  if (legacyChanges.length > 0) {
    return {
      stale: true,
      reason: `legacy analysis inputs changed: ${legacyChanges.join(",")}`,
      currentInputHash: hashes.current,
      backfilled: false,
    };
  }

  // 再读一次，避免在兼容检查和回填之间遗漏并发输入变更。
  const confirmedHashes = await calculateInputHashes(sessionId);
  if (!confirmedHashes || confirmedHashes.current !== hashes.current) {
    return {
      stale: true,
      reason: "analysis input changed while upgrading legacy report",
      currentInputHash: confirmedHashes?.current ?? null,
      backfilled: false,
    };
  }

  const backfilled = await prisma.trainingAnalysis.updateMany({
    where: {
      id: analysis.id,
      status: "COMPLETED",
      inputHash: "",
      updatedAt: analysis.updatedAt,
    },
    data: {
      inputHash: confirmedHashes.current,
      promptVersion: TRAINING_ANALYSIS_LEGACY_VERSION,
      schemaVersion: TRAINING_ANALYSIS_LEGACY_VERSION,
      modelVersion: TRAINING_ANALYSIS_LEGACY_VERSION,
      ruleVersion: TRAINING_ANALYSIS_LEGACY_VERSION,
    },
  });

  return {
    stale: false,
    reason: null,
    currentInputHash: confirmedHashes.current,
    backfilled: backfilled.count > 0,
  };
}
