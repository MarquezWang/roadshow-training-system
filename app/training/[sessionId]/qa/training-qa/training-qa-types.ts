export type TrainingQaQuestion = {
  id: string;
  orderIndex: number;
  questionText: string;
  questionType: string | null;
  source: string;
  basis: string | null;
  answer: {
    id: string;
    answerText: string | null;
    revealedQuestionText: boolean;
    startedAt: string | null;
    endedAt: string | null;
    durationSec: number | null;
  } | null;
};

export type QaPhase =
  "READY" | "ASKING" | "COUNTDOWN" | "ANSWERING" | "SAVING" | "DONE";
