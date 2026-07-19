import { isRecord } from "@/lib/type-guards";

export type ValidatedGeneratedQuestion = {
  type: string;
  perspective: string;
  content: string;
  focus: string;
  suggestedDirection: string;
  evidence: {
    evidenceText: string;
    evidenceLocation: string;
  };
  factCheckNote: string;
};

export type ValidatedGeneratedQuestions = {
  questions: ValidatedGeneratedQuestion[];
};

const expectedPerspectiveCounts = new Map([
  ["技术专家", 2],
  ["产业方", 2],
  ["投资机构", 2],
  ["知识产权专家", 1],
  ["成果转化专家", 2],
  ["合作对接方", 1],
]);

const factPattern =
  /(\d+(\.\d+)?\s*(年|月|日|万元|亿元|元|%|％|亩|项|件|个|家|省|市|页|轮|次|吨|公斤|kg|KG|m²|㎡|万|亿)?)|([一二三四五六七八九十百千万亿]+(年|月|项|件|个|家|省|市|轮|次))/;

function assertNonEmptyString(value: unknown, fieldName: string) {
  if (typeof value !== "string") {
    throw new Error(`问题 JSON 字段 ${fieldName} 必须是字符串。`);
  }

  const trimmedValue = value.trim();

  if (!trimmedValue) {
    throw new Error(`问题 JSON 字段 ${fieldName} 不能为空。`);
  }

  return trimmedValue;
}

function assertOptionalString(value: unknown, fieldName: string) {
  if (value === undefined || value === null) {
    return "";
  }

  if (typeof value !== "string") {
    throw new Error(`问题 JSON 字段 ${fieldName} 必须是字符串。`);
  }

  return value.trim();
}

function parseEvidence(value: unknown, fieldName: string) {
  if (!isRecord(value)) {
    throw new Error(`问题 JSON 字段 ${fieldName} 必须是对象。`);
  }

  return {
    evidenceText: assertNonEmptyString(
      value.evidenceText,
      `${fieldName}.evidenceText`,
    ),
    evidenceLocation: assertOptionalString(
      value.evidenceLocation,
      `${fieldName}.evidenceLocation`,
    ),
  };
}

function hasSpecificFact(text: string) {
  return factPattern.test(text);
}

function isMissingEvidenceText(text: string) {
  const normalized = text
    .replace(/[\s，。！？、；：,.!?;:'"“”‘’（）()【】\[\]]/g, "")
    .toLowerCase();

  return /(?:材料)?(?:未提供|未提及|未说明|未明确|无法支持|无法判断|没有提供|没有提及|依据不足|证据不足)/.test(
    normalized,
  );
}

function normalizeEvidenceSearchText(text: string) {
  return text.replace(/[\s，。！？、；：,.!?;:'"“”‘’（）()【】\[\]]/g, "");
}

function evidenceAppearsInSources(evidenceText: string, sourceTexts: string[]) {
  const normalizedEvidence = normalizeEvidenceSearchText(evidenceText);
  if (!normalizedEvidence) return false;

  return sourceTexts.some((sourceText) =>
    normalizeEvidenceSearchText(sourceText).includes(normalizedEvidence),
  );
}

function assertEvidenceForQuestionFacts(
  question: ValidatedGeneratedQuestion,
  index: number,
  sourceTexts: string[],
) {
  if (!hasSpecificFact(question.content)) {
    return;
  }

  if (
    isMissingEvidenceText(question.evidence.evidenceText) ||
    !hasSpecificFact(question.evidence.evidenceText)
  ) {
    throw new Error(
      `questions[${index}].content 包含具体数字或数量，但 evidenceText 未提供材料依据。`,
    );
  }

  if (
    sourceTexts.length > 0 &&
    !evidenceAppearsInSources(question.evidence.evidenceText, sourceTexts)
  ) {
    throw new Error(
      `questions[${index}].content 包含具体数字或数量，但 evidenceText 不是材料原文片段。`,
    );
  }

  if (!question.factCheckNote) {
    throw new Error(
      `questions[${index}].content 包含具体数字或数量，factCheckNote 必须说明依据来自材料原文或需人工复核。`,
    );
  }
}

export function validateGeneratedQuestions(
  questionJson: unknown,
  options: { sourceTexts?: string[] } = {},
): ValidatedGeneratedQuestions {
  if (!isRecord(questionJson)) {
    throw new Error("问题 JSON 顶层结构必须是对象。");
  }

  if (!Array.isArray(questionJson.questions)) {
    throw new Error("问题 JSON 字段 questions 必须是数组。");
  }

  if (questionJson.questions.length !== 10) {
    throw new Error(
      `questions 数量必须为 10，当前为 ${questionJson.questions.length}。`,
    );
  }

  const perspectiveCounts = new Map<string, number>();
  const questions = questionJson.questions.map((item, index) => {
    if (!isRecord(item)) {
      throw new Error(`questions[${index}] 必须是对象。`);
    }

    const question = {
      type: assertNonEmptyString(item.type, `questions[${index}].type`),
      perspective: assertNonEmptyString(
        item.perspective,
        `questions[${index}].perspective`,
      ),
      content: assertNonEmptyString(item.content, `questions[${index}].content`),
      focus: assertNonEmptyString(item.focus, `questions[${index}].focus`),
      suggestedDirection: assertNonEmptyString(
        item.suggestedDirection,
        `questions[${index}].suggestedDirection`,
      ),
      evidence: parseEvidence(item.evidence, `questions[${index}].evidence`),
      factCheckNote: assertOptionalString(
        item.factCheckNote,
        `questions[${index}].factCheckNote`,
      ),
    };

    if (!expectedPerspectiveCounts.has(question.perspective)) {
      throw new Error(
        `questions[${index}].perspective 不在允许范围内：${question.perspective}。`,
      );
    }

    assertEvidenceForQuestionFacts(
      question,
      index,
      options.sourceTexts?.filter(Boolean) ?? [],
    );

    perspectiveCounts.set(
      question.perspective,
      (perspectiveCounts.get(question.perspective) ?? 0) + 1,
    );

    return question;
  });

  for (const [perspective, expectedCount] of expectedPerspectiveCounts) {
    const actualCount = perspectiveCounts.get(perspective) ?? 0;

    if (actualCount !== expectedCount) {
      throw new Error(
        `${perspective} 问题数量必须为 ${expectedCount}，当前为 ${actualCount}。`,
      );
    }
  }

  return {
    questions,
  };
}
