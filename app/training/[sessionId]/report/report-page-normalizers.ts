import type {
  TrainingQaQuestion,
  TrainingRecording,
  TrainingTranscript,
} from "./report-types";
import type { ReportTrainingAnalysis } from "./use-report-analysis-generation";
import {
  parseActionItems,
  parseDiagnostics,
  parseDynamicFollowupReview,
  parseJsonArray,
  parseJsonObject,
  parseOnePageSummary,
} from "./report-page-parsers";

type SourceTranscript = Readonly<{
  id: string;
  recordingId: string;
  sessionId: string;
  status: string;
  source: string;
  language: string;
  text: string;
  segmentsJson: string | null;
  errorMessage: string | null;
  startedAt: Date | null;
  completedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}>;

type SourceRecording = Readonly<{
  id: string;
  phase: string;
  mimeType: string;
  sizeBytes: number;
  durationSec: number | null;
  transcript: SourceTranscript | null;
}>;

type SourceAnalysis = Readonly<{
  id: string;
  status: string;
  overallScore: number | null;
  summary: string;
  errorMessage: string | null;
  updatedAt: Date;
  strengthsJson: string | null;
  weaknessesJson: string | null;
  suggestionsJson: string | null;
  coverageJson: string | null;
  timingJson: string | null;
  slideSyncJson: string | null;
  riskQuestionsJson: string | null;
  rawResultJson: string | null;
}>;

type SourceTrainingQuestion = Readonly<{
  id: string;
  orderIndex: number;
  questionText: string;
  questionType: string | null;
  source: string;
  basis: string | null;
  answer: Readonly<{
    id: string;
    answerText: string | null;
    revealedQuestionText: boolean;
    startedAt: Date | null;
    endedAt: Date | null;
    durationSec: number | null;
    recording: SourceRecording | null;
  }> | null;
}>;

function normalizeTranscript(transcript: SourceTranscript): TrainingTranscript {
  return {
    ...transcript,
    startedAt: transcript.startedAt?.toISOString() ?? null,
    completedAt: transcript.completedAt?.toISOString() ?? null,
    createdAt: transcript.createdAt.toISOString(),
    updatedAt: transcript.updatedAt.toISOString(),
  };
}

function normalizeRecording(
  sessionId: string,
  recording: SourceRecording,
): TrainingRecording {
  return {
    ...recording,
    playbackUrl: `/training/${sessionId}/recordings/${recording.id}`,
    transcript: recording.transcript
      ? normalizeTranscript(recording.transcript)
      : null,
  };
}

export function normalizePitchRecording(
  sessionId: string,
  recordings: readonly SourceRecording[],
) {
  const pitchRecording =
    recordings.find(
      (recording) => recording.phase === "PITCH" && recording.transcript,
    ) ?? recordings.find((recording) => recording.phase === "PITCH") ?? null;

  return pitchRecording ? normalizeRecording(sessionId, pitchRecording) : null;
}

export function normalizeReportAnalysis(
  analysis: SourceAnalysis | null | undefined,
): ReportTrainingAnalysis | null {
  if (!analysis) {
    return null;
  }

  const rawResult = parseJsonObject(analysis.rawResultJson);

  return {
    id: analysis.id,
    status: analysis.status,
    overallScore: analysis.overallScore,
    summary: analysis.summary,
    errorMessage: analysis.errorMessage,
    updatedAt: analysis.updatedAt.toISOString(),
    strengths: parseJsonArray<string>(analysis.strengthsJson),
    weaknesses: parseJsonArray<string>(analysis.weaknessesJson),
    suggestions: parseJsonArray<string>(analysis.suggestionsJson),
    onePageSummary: parseOnePageSummary(rawResult.onePageSummary),
    diagnostics: parseDiagnostics(rawResult.diagnostics),
    actionItems: parseActionItems(rawResult.actionItems),
    nextTrainingTasks: Array.isArray(rawResult.nextTrainingTasks)
      ? rawResult.nextTrainingTasks.filter(
          (item): item is string =>
            typeof item === "string" && item.trim().length > 0,
        )
      : [],
    contentCoverage: parseJsonArray<{
      item: string;
      covered: string;
      evidence: string;
      suggestion: string;
    }>(analysis.coverageJson),
    timing: parseJsonObject(analysis.timingJson),
    slideSync: parseJsonObject(analysis.slideSyncJson),
    riskQuestions: parseJsonArray<string>(analysis.riskQuestionsJson),
    qaReviews: Array.isArray(rawResult.qaReviews) ? rawResult.qaReviews : [],
    dynamicFollowupReview: parseDynamicFollowupReview(
      rawResult.dynamicFollowupReview,
    ),
  };
}

export function normalizeQaQuestions(
  sessionId: string,
  questions: readonly SourceTrainingQuestion[],
): TrainingQaQuestion[] {
  return questions.map((question) => ({
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
          recording: question.answer.recording
            ? normalizeRecording(sessionId, question.answer.recording)
            : null,
        }
      : null,
  }));
}
