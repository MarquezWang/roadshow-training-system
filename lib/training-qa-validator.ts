const allowedQuestionTypes = new Set([
  "TECHNICAL",
  "MARKET",
  "BUSINESS",
  "TEAM",
  "RISK",
  "FINANCE",
]);

export type GeneratedTrainingQuestion = {
  orderIndex: number;
  questionType: string;
  questionText: string;
  basis: string;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function readString(value: unknown, fieldName: string) {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`${fieldName} 必须是非空字符串。`);
  }

  return value.trim();
}

const compoundQuestionKeywords = [
  "请分别说明",
  "分别阐述",
  "分别回答",
  "请分别阐述",
  "请分别回答",
];

function checkCompoundQuestion(text: string) {
  const hit = compoundQuestionKeywords.find((keyword) => text.includes(keyword));
  if (hit) {
    throw new Error(`questionText 可能包含复合提问，检测到: "${hit}"`);
  }
}

function readOrderIndex(value: unknown, fieldName: string) {
  const orderIndex = Number(value);

  if (!Number.isInteger(orderIndex) || orderIndex < 1 || orderIndex > 3) {
    throw new Error(`${fieldName} 必须是 1 到 3 的整数。`);
  }

  return orderIndex;
}

export function validateGeneratedTrainingQuestions(
  value: unknown,
): GeneratedTrainingQuestion[] {
  if (!isRecord(value)) {
    throw new Error("AI 输出顶层结构必须是对象。");
  }

  if (!Array.isArray(value.questions)) {
    throw new Error("questions 必须是数组。");
  }

  if (value.questions.length !== 3) {
    throw new Error("questions 必须有且仅有 3 条。");
  }

  const questions = value.questions.map((item, index) => {
    if (!isRecord(item)) {
      throw new Error(`questions[${index}] 必须是对象。`);
    }

    const orderIndex = readOrderIndex(
      item.orderIndex,
      `questions[${index}].orderIndex`,
    );
    const questionType = readString(
      item.questionType,
      `questions[${index}].questionType`,
    );

    if (!allowedQuestionTypes.has(questionType)) {
      throw new Error(
        `questions[${index}].questionType 必须是允许的问题类型。`,
      );
    }

    const questionText = readString(
        item.questionText,
        `questions[${index}].questionText`,
      );

      checkCompoundQuestion(questionText);

      return {
        orderIndex,
        questionType,
        questionText,
        basis: readString(item.basis, `questions[${index}].basis`),
      };
  });

  const sortedOrderIndexes = questions
    .map((question) => question.orderIndex)
    .sort((first, second) => first - second);

  if (sortedOrderIndexes.join(",") !== "1,2,3") {
    throw new Error("questions.orderIndex 必须分别为 1、2、3。");
  }

  return questions.sort((first, second) => first.orderIndex - second.orderIndex);
}
