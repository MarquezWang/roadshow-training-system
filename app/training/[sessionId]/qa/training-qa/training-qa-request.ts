type BuildQaEndRequestOptions = {
  answerStartedAt: Date | null;
  qaDurationSec: number;
  questionId: string | undefined;
  recordingId: string | null | undefined;
  revealedQuestionText: boolean;
};

export function buildQaEndRequestBody({
  answerStartedAt,
  qaDurationSec,
  questionId,
  recordingId,
  revealedQuestionText,
}: BuildQaEndRequestOptions) {
  return {
    questionId,
    answerStartedAt: answerStartedAt?.toISOString(),
    revealedQuestionText,
    recordingId,
    qaDurationSec,
  };
}

type BuildQaAnswerRequestOptions = {
  answerStartedAt: Date | null;
  finish: boolean;
  preferredNextQuestionId: string | undefined;
  qaDurationSec: number;
  recordingId: string | null | undefined;
  revealedQuestionText: boolean;
};

export function buildQaAnswerRequestBody({
  answerStartedAt,
  finish,
  preferredNextQuestionId,
  qaDurationSec,
  recordingId,
  revealedQuestionText,
}: BuildQaAnswerRequestOptions) {
  return {
    answerStartedAt: answerStartedAt?.toISOString(),
    revealedQuestionText,
    recordingId,
    qaDurationSec,
    finish,
    preferredNextQuestionId,
  };
}
