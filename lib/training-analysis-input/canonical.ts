import { sha256 } from "./hash";
import type { TrainingAnalysisInputSession } from "./repository";

export function buildLegacyTrainingAnalysisInput(
  session: TrainingAnalysisInputSession,
) {
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

  return session.projectContextSnapshot
    ? {
        ...legacySession,
        project: undefined,
        projectContextSnapshot: sha256(session.projectContextSnapshot),
      }
    : legacySession;
}

export function buildCurrentTrainingAnalysisInput(
  session: TrainingAnalysisInputSession,
) {
  return {
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
}
