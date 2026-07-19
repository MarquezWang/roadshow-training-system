type BuildQaEndRequestOptions = {
  qaDurationSec: number;
  questionId: string | undefined;
  recordingId: string | null | undefined;
  revealedQuestionText: boolean;
};

export function buildQaEndRequestBody({
  qaDurationSec,
  questionId,
  recordingId,
  revealedQuestionText,
}: BuildQaEndRequestOptions) {
  return {
    questionId,
    revealedQuestionText,
    recordingId,
    qaDurationSec,
  };
}

type BuildQaAnswerRequestOptions = {
  finish: boolean;
  preferredNextQuestionId: string | undefined;
  qaDurationSec: number;
  recordingId: string | null | undefined;
  revealedQuestionText: boolean;
};

export function buildQaAnswerRequestBody({
  finish,
  preferredNextQuestionId,
  qaDurationSec,
  recordingId,
  revealedQuestionText,
}: BuildQaAnswerRequestOptions) {
  return {
    revealedQuestionText,
    recordingId,
    qaDurationSec,
    finish,
    preferredNextQuestionId,
  };
}
