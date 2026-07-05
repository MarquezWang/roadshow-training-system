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

  if (
    pitchTranscriptLength < INVALID_PITCH_TRANSCRIPT_CHARS ||
    allQaAnswersEmpty
  ) {
    return {
      level: "INVALID_OR_TEST_ONLY",
      pitchTranscriptLength,
      effectiveQaAnswerCount,
      message:
        "本次训练样本不足，可能只是流程测试，不建议将本次分数作为项目真实表现判断依据。",
    };
  }

  if (
    pitchTranscriptLength < LOW_VALIDITY_PITCH_TRANSCRIPT_CHARS ||
    effectiveQaAnswerCount < LOW_VALIDITY_MIN_QA_ANSWERS
  ) {
    return {
      level: "LOW_VALIDITY",
      pitchTranscriptLength,
      effectiveQaAnswerCount,
      message:
        "本次训练内容较少，分析结果仅供参考。建议完成一次较完整的路演和答辩后，再查看训练表现分。",
    };
  }

  return {
    level: "NORMAL",
    pitchTranscriptLength,
    effectiveQaAnswerCount,
    message: null,
  };
}
