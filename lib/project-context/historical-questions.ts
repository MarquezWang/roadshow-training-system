export const MAX_HISTORICAL_QUESTIONS = 20;

const HISTORICAL_QUESTION_PERSPECTIVE_ORDER = [
  "技术专家",
  "产业方",
  "投资机构",
  "知识产权专家",
  "成果转化专家",
  "合作对接方",
] as const;

export type HistoricalQuestionRecord = {
  id: string;
  projectField: string | null;
  perspective: string;
  questionText: string;
  createdAt: Date;
};

function countBy<T>(items: T[], keyGetter: (item: T) => string) {
  return items.reduce<Record<string, number>>((result, item) => {
    const key = keyGetter(item);
    result[key] = (result[key] ?? 0) + 1;
    return result;
  }, {});
}

function getQuestionRelevance(
  question: Pick<HistoricalQuestionRecord, "projectField">,
  projectField: string,
) {
  if (question.projectField === projectField) {
    return {
      priority: 0,
    };
  }

  if (question.projectField === null) {
    return {
      priority: 1,
    };
  }

  return {
    priority: 2,
  };
}

export function selectHistoricalQuestions<T extends HistoricalQuestionRecord>(
  questions: T[],
  projectField: string,
) {
  const totalAvailable = questions.length;
  const sortedQuestions = questions
    .filter((question) => question.questionText.trim() !== "")
    .map((question) => ({
      ...question,
      relevancePriority: getQuestionRelevance(question, projectField).priority,
    }))
    .sort((first, second) => {
      if (first.relevancePriority !== second.relevancePriority) {
        return first.relevancePriority - second.relevancePriority;
      }

      return first.createdAt.getTime() - second.createdAt.getTime();
    });
  const selected: T[] = [];
  const selectedIds = new Set<string>();

  const trySelect = (question: (typeof sortedQuestions)[number]) => {
    if (
      selected.length >= MAX_HISTORICAL_QUESTIONS ||
      selectedIds.has(question.id)
    ) {
      return;
    }

    selected.push(question);
    selectedIds.add(question.id);
  };

  for (const perspective of HISTORICAL_QUESTION_PERSPECTIVE_ORDER) {
    const matchedQuestion = sortedQuestions.find(
      (question) => question.perspective === perspective,
    );

    if (matchedQuestion) {
      trySelect(matchedQuestion);
    }
  }

  for (const question of sortedQuestions) {
    trySelect(question);
  }

  return {
    questions: selected,
    debug: {
      totalAvailable,
      selected: selected.length,
      byPerspective: countBy(selected, (item) => item.perspective),
      truncated: totalAvailable > selected.length,
    },
  };
}
