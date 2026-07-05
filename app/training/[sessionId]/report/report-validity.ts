import {
  isDynamicFollowupQuestion,
  type TrainingQaQuestion,
  type TrainingRecording,
} from "./report-types";

export type TrainingValidityLevel =
  | "NORMAL"
  | "LOW_VALIDITY"
  | "INVALID_OR_TEST_ONLY";

export type TrainingValidity = Readonly<{
  level: TrainingValidityLevel;
  pitchTranscriptLength: number;
  effectiveQaAnswerCount: number;
  isPitchTranscriptInsufficient: boolean;
  isQaSampleInsufficient: boolean;
  messages: string[];
  message: string | null;
}>;

const LOW_VALIDITY_PITCH_TRANSCRIPT_CHARS = 300;
const INVALID_PITCH_TRANSCRIPT_CHARS = 100;
const LOW_VALIDITY_MIN_QA_ANSWERS = 2;

function countNonWhitespaceChars(text: string | null | undefined) {
  return (text ?? "").replace(/\s+/g, "").length;
}

function getQaAnswerText(question: TrainingQaQuestion) {
  return (
    question.answer?.recording?.transcript?.text?.trim() ||
    question.answer?.answerText?.trim() ||
    ""
  );
}

export function assessTrainingValidity(
  recording: TrainingRecording | null,
  qaQuestions: TrainingQaQuestion[],
): TrainingValidity {
  const pitchTranscriptLength = countNonWhitespaceChars(
    recording?.transcript?.text,
  );
  const regularQaQuestions = qaQuestions.filter(
    (question) => !isDynamicFollowupQuestion(question),
  );
  const effectiveQaAnswerCount = regularQaQuestions.filter(
    (question) => countNonWhitespaceChars(getQaAnswerText(question)) > 0,
  ).length;
  const allQaAnswersEmpty =
    regularQaQuestions.length > 0 && effectiveQaAnswerCount === 0;
  const isPitchTranscriptInvalid =
    pitchTranscriptLength < INVALID_PITCH_TRANSCRIPT_CHARS;
  const isPitchTranscriptInsufficient =
    pitchTranscriptLength < LOW_VALIDITY_PITCH_TRANSCRIPT_CHARS;
  const isQaSampleInsufficient =
    effectiveQaAnswerCount < LOW_VALIDITY_MIN_QA_ANSWERS;
  const messages = [
    ...(isPitchTranscriptInsufficient
      ? ["本次训练可能只是流程测试，不建议参考表现分。"]
      : []),
    ...(isQaSampleInsufficient
      ? ["答辩样本不足，答辩表现仅供参考。"]
      : []),
  ];

  if (isPitchTranscriptInvalid || allQaAnswersEmpty) {
    return {
      level: "INVALID_OR_TEST_ONLY",
      pitchTranscriptLength,
      effectiveQaAnswerCount,
      isPitchTranscriptInsufficient,
      isQaSampleInsufficient,
      messages:
        messages.length > 0
          ? messages
          : ["本次训练样本不足，可能只是流程测试，不建议参考表现分。"],
      message:
        messages.length > 0
          ? messages.join(" ")
          : "本次训练样本不足，可能只是流程测试，不建议参考表现分。",
    };
  }

  if (isPitchTranscriptInsufficient || isQaSampleInsufficient) {
    return {
      level: "LOW_VALIDITY",
      pitchTranscriptLength,
      effectiveQaAnswerCount,
      isPitchTranscriptInsufficient,
      isQaSampleInsufficient,
      messages,
      message: messages.join(" "),
    };
  }

  return {
    level: "NORMAL",
    pitchTranscriptLength,
    effectiveQaAnswerCount,
    isPitchTranscriptInsufficient,
    isQaSampleInsufficient,
    messages: [],
    message: null,
  };
}
