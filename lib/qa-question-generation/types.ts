import type { Dispatch, SetStateAction } from "react";

export type QaGenerationQuestion = {
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

export type QaGenerationPhase =
  | "READY"
  | "ASKING"
  | "COUNTDOWN"
  | "ANSWERING"
  | "SAVING"
  | "DONE";

export type UseQaQuestionGenerationOptions = {
  sessionId: string;
  dynamicFollowupExperiment: boolean;
  isGuardResolved: boolean;
  qaPhase: QaGenerationPhase;
  questions: QaGenerationQuestion[];
  setQuestions: Dispatch<SetStateAction<QaGenerationQuestion[]>>;
  setCurrentQuestionIndex: (questionIndex: number) => void;
  setMessage: (message: string) => void;
};

export type UseBaseQaQuestionGenerationOptions = Pick<
  UseQaQuestionGenerationOptions,
  | "sessionId"
  | "dynamicFollowupExperiment"
  | "isGuardResolved"
  | "questions"
  | "setQuestions"
  | "setCurrentQuestionIndex"
  | "setMessage"
>;

export type UseDynamicFollowupQuestionOptions = Pick<
  UseQaQuestionGenerationOptions,
  | "sessionId"
  | "dynamicFollowupExperiment"
  | "isGuardResolved"
  | "qaPhase"
  | "questions"
  | "setQuestions"
>;
