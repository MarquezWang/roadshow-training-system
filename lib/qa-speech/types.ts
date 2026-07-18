import type {
  Dispatch,
  MutableRefObject,
  SetStateAction,
} from "react";

export type QaSpeechQuestion = {
  id: string;
  orderIndex: number;
  questionText: string;
  questionType: string | null;
  source: string;
  basis: string | null;
};

export type QuestionTextDialog =
  | {
      question: QaSpeechQuestion;
      mode: "reading" | "fallback" | "review";
    }
  | null;

export type UseQaSpeechOptions = {
  sessionId: string;
  status: string;
  hasAutoEndedRef: MutableRefObject<boolean>;
  beginPreAnswerCountdown: () => void;
  onMessageChange: Dispatch<SetStateAction<string>>;
  onQuestionTextRevealed: (questionId: string) => void;
};

export type QuestionSpeechRun = {
  question: QaSpeechQuestion;
  speechRunId: number;
  speechStartedRef: { current: boolean };
  isCurrentSpeechRun: () => boolean;
  moveOn: () => void;
};
