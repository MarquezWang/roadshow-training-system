import { prisma } from "@/lib/prisma";

export const DYNAMIC_FOLLOWUP_ORDER_INDEX = 4;
export const DYNAMIC_FOLLOWUP_SOURCE = "DYNAMIC_FOLLOWUP";
export const DYNAMIC_FOLLOWUP_TYPE = "FOLLOWUP";
const DYNAMIC_FOLLOWUP_BASIS = "基于本轮 Pitch 转写生成的动态追问";

const dynamicQuestionSelect = {
  id: true,
  orderIndex: true,
  questionText: true,
  questionType: true,
  source: true,
  basis: true,
  answer: {
    select: {
      id: true,
      answerText: true,
      revealedQuestionText: true,
      startedAt: true,
      endedAt: true,
      durationSec: true,
    },
  },
} as const;

export async function findExistingDynamicQuestion(sessionId: string) {
  return prisma.trainingQuestion.findFirst({
    where: {
      sessionId,
      orderIndex: DYNAMIC_FOLLOWUP_ORDER_INDEX,
      source: DYNAMIC_FOLLOWUP_SOURCE,
    },
    select: dynamicQuestionSelect,
  });
}

export function serializeDynamicQuestion(
  question: Awaited<ReturnType<typeof findExistingDynamicQuestion>>,
) {
  if (!question) {
    return null;
  }

  return {
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
        }
      : null,
  };
}

export type SerializedDynamicQuestion = NonNullable<
  ReturnType<typeof serializeDynamicQuestion>
>;

export async function createOrReturnDynamicQuestion(params: {
  sessionId: string;
  projectId: string;
  questionText: string;
}) {
  const { sessionId, projectId, questionText } = params;
  const existingQuestion = await findExistingDynamicQuestion(sessionId);
  const serializedExistingQuestion =
    serializeDynamicQuestion(existingQuestion);

  if (serializedExistingQuestion) {
    return serializedExistingQuestion;
  }

  try {
    const createdQuestion = await prisma.trainingQuestion.create({
      data: {
        sessionId,
        projectId,
        orderIndex: DYNAMIC_FOLLOWUP_ORDER_INDEX,
        questionText,
        questionType: DYNAMIC_FOLLOWUP_TYPE,
        source: DYNAMIC_FOLLOWUP_SOURCE,
        basis: DYNAMIC_FOLLOWUP_BASIS,
      },
      select: dynamicQuestionSelect,
    });

    const serializedCreatedQuestion =
      serializeDynamicQuestion(createdQuestion);

    if (serializedCreatedQuestion) {
      return serializedCreatedQuestion;
    }
  } catch (error) {
    const fallbackQuestion = await findExistingDynamicQuestion(sessionId);
    const serializedFallbackQuestion =
      serializeDynamicQuestion(fallbackQuestion);

    if (serializedFallbackQuestion) {
      return serializedFallbackQuestion;
    }

    throw error;
  }

  throw new Error("dynamic followup question create failed");
}
