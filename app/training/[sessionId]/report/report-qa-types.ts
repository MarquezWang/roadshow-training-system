export type QaTranscript = {
  status: string;
  text: string;
  errorMessage: string | null;
};

export type QaRecording = {
  id: string;
  playbackUrl: string;
  durationSec: number | null;
};

export type QaQuestion = {
  id: string;
  orderIndex: number;
  questionText: string;
  questionType: string | null;
  basis: string | null;
  answer: {
    answerText: string | null;
    revealedQuestionText: boolean;
    durationSec: number | null;
    recording: QaRecording | null;
  } | null;
};

export type QaReview = {
  questionId: string;
  responseQuality: string;
  responseQualityLabel: string;
  judgeIntent: string;
  answerSummary: string;
  evidenceUse: string;
  missingPoints: string[];
  improvementAdvice: string;
  betterAnswerOutline: string[];
};

export type DynamicFollowupReview = {
  questionId: string;
  question: string;
  answerSummary: string;
  targetWeakness: string;
  evidenceSupplement: string;
  improvementAdvice: string;
};
