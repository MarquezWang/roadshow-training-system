import type { TrainingQaQuestion } from "./report-types";
import {
  normalizeRecording,
  type SourceRecording,
} from "./report-recording-normalizers";

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
