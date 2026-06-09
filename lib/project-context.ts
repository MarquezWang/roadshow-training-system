import { prisma } from "@/lib/prisma";

const REAL_RULE_NAME = "路演大赛真实评审规则";
const DEFAULT_RULE_NAME = "路演大赛通用评审规则";
const MAX_SINGLE_FILE_TEXT_LENGTH = 20_000;
const MAX_ALL_FILES_TEXT_LENGTH = 60_000;
const MAX_EXPERT_COMMENTS = 20;
const MAX_HISTORICAL_QUESTIONS = 20;
const MAX_LONG_EXPERT_COMMENTS = 2;
const LONG_EXPERT_COMMENT_LENGTH = 600;
const MIN_EXPERT_COMMENT_LENGTH = 8;
const EXPERT_COMMENT_DIMENSION_ORDER = [
  "项目团队",
  "科技含量",
  "市场机会",
  "路演表达",
  "其他",
] as const;
const EXPERT_COMMENT_QUOTA_BY_BUCKET = {
  项目团队: 4,
  科技含量: 6,
  市场机会: 8,
  "路演表达/其他": 2,
} as const;
const HISTORICAL_QUESTION_PERSPECTIVE_ORDER = [
  "技术专家",
  "产业方",
  "投资机构",
  "知识产权专家",
  "成果转化专家",
  "合作对接方",
] as const;

export class ProjectContextNotFoundError extends Error {
  constructor(projectId: string) {
    super(`项目不存在：${projectId}`);
    this.name = "ProjectContextNotFoundError";
  }
}

export type ProjectAIContext = {
  project: {
    id: string;
    name: string;
    field: string;
    stage: string;
    summary: string;
    coreTechnology: string;
    applicationScenario: string;
    businessModel: string;
    cooperationDemand: string;
  };
  files: Array<{
    id: string;
    originalName: string;
    fileType: string;
    includeInAIContext: boolean;
    extractedText: string;
    truncated: boolean;
  }>;
  evaluationRule: {
    id: string;
    name: string;
    contestName: string;
    version: string;
    totalScore: number;
    description: string | null;
    rawText: string | null;
  } | null;
  criteria: Array<{
    id: string;
    category: string | null;
    name: string;
    weight: number;
    description: string;
    scoringGuide: string | null;
    sortOrder: number;
  }>;
  expertComments: Array<{
    id: string;
    contestName: string | null;
    projectField: string | null;
    dimension: string;
    normalizedDimension: string;
    commentText: string;
    problemType: string | null;
    suggestionType: string | null;
    scoreRange: string | null;
    relevanceReason: string;
  }>;
  historicalQuestions: Array<{
    id: string;
    contestName: string | null;
    projectField: string | null;
    perspective: string;
    questionText: string;
    focus: string | null;
  }>;
  limits: {
    maxSingleFileTextLength: number;
    maxAllFilesTextLength: number;
    maxExpertComments: number;
    maxHistoricalQuestions: number;
  };
  truncated: {
    any: boolean;
    files: boolean;
    allFilesText: boolean;
    expertComments: boolean;
    historicalQuestions: boolean;
  };
  debug: {
    fileSelection: {
      totalFiles: number;
      parsedSuccessFiles: number;
      includedFiles: number;
      excludedFiles: number;
    };
    expertCommentSelection: {
      totalAvailable: number;
      selected: number;
      byNormalizedDimension: Record<string, number>;
      truncated: boolean;
    };
    historicalQuestionSelection: {
      totalAvailable: number;
      selected: number;
      byPerspective: Record<string, number>;
      truncated: boolean;
    };
  };
};

function takeFileTexts(
  files: Array<{
    id: string;
    originalName: string;
    fileType: string;
    includeInAIContext: boolean;
    extractedText: string | null;
  }>,
) {
  let remaining = MAX_ALL_FILES_TEXT_LENGTH;
  let fileTruncated = false;
  let allFilesTextTruncated = false;

  const result = [];

  for (const file of files) {
    if (!file.extractedText || remaining <= 0) {
      allFilesTextTruncated = true;
      continue;
    }

    const singleFileText = file.extractedText.slice(
      0,
      MAX_SINGLE_FILE_TEXT_LENGTH,
    );
    const truncatedBySingleLimit =
      file.extractedText.length > MAX_SINGLE_FILE_TEXT_LENGTH;
    const text = singleFileText.slice(0, remaining);
    const truncatedByTotalLimit = singleFileText.length > remaining;

    remaining -= text.length;
    fileTruncated =
      fileTruncated || truncatedBySingleLimit || truncatedByTotalLimit;
    allFilesTextTruncated =
      allFilesTextTruncated || truncatedByTotalLimit || remaining <= 0;

    result.push({
      id: file.id,
      originalName: file.originalName,
      fileType: file.fileType,
      includeInAIContext: file.includeInAIContext,
      extractedText: text,
      truncated: truncatedBySingleLimit || truncatedByTotalLimit,
    });
  }

  return {
    files: result,
    filesTruncated: fileTruncated,
    allFilesTextTruncated,
  };
}

async function findEvaluationRule() {
  const rule =
    (await prisma.evaluationRule.findFirst({
      where: {
        name: REAL_RULE_NAME,
      },
      include: {
        criteria: {
          orderBy: {
            sortOrder: "asc",
          },
        },
      },
    })) ??
    (await prisma.evaluationRule.findFirst({
      where: {
        name: DEFAULT_RULE_NAME,
      },
      include: {
        criteria: {
          orderBy: {
            sortOrder: "asc",
          },
        },
      },
    })) ??
    (await prisma.evaluationRule.findFirst({
      orderBy: {
        createdAt: "asc",
      },
      include: {
        criteria: {
          orderBy: {
            sortOrder: "asc",
          },
        },
      },
    }));

  return rule;
}

async function findExpertComments(projectField: string) {
  const comments = await prisma.expertComment.findMany({
    orderBy: {
      createdAt: "desc",
    },
  });

  return selectExpertComments(comments, projectField);
}

async function findHistoricalQuestions(projectField: string) {
  const questions = await prisma.historicalQuestion.findMany({
    orderBy: {
      createdAt: "asc",
    },
  });

  return selectHistoricalQuestions(questions, projectField);
}

type ExpertCommentRecord = Awaited<
  ReturnType<typeof prisma.expertComment.findMany>
>[number];

type HistoricalQuestionRecord = Awaited<
  ReturnType<typeof prisma.historicalQuestion.findMany>
>[number];

type SelectedExpertComment = ExpertCommentRecord & {
  normalizedDimension: string;
  relevanceReason: string;
};

function normalizeText(value: string) {
  return value.trim().replace(/\s+/g, "");
}

function normalizeLooseText(value: string) {
  return value.trim().replace(/\s+/g, " ");
}

function countNonWhitespaceChars(value: string) {
  return Array.from(normalizeText(value)).length;
}

function hasAnyKeyword(value: string, keywords: string[]) {
  return keywords.some((keyword) => value.includes(keyword));
}

export function normalizeCommentDimension(value: string) {
  if (
    hasAnyKeyword(value, [
      "技术",
      "科技含量",
      "研发",
      "算法",
      "系统",
      "性能",
      "先进",
      "指标",
    ])
  ) {
    return "科技含量";
  }

  if (
    hasAnyKeyword(value, [
      "市场",
      "市场机会",
      "客户",
      "需求",
      "推广",
      "竞争",
      "应用",
      "场景",
      "知识产权",
      "专利",
      "软著",
      "壁垒",
      "保护",
      "转化落地",
      "转化",
      "产业化",
      "试点",
      "实施",
      "商业模式",
      "收入",
      "盈利",
      "成本",
      "融资",
      "投资",
    ])
  ) {
    return "市场机会";
  }

  if (
    hasAnyKeyword(value, [
      "团队",
      "项目团队",
      "成员",
      "负责人",
      "经验",
      "结构",
      "稳定",
    ])
  ) {
    return "项目团队";
  }

  if (hasAnyKeyword(value, ["路演表达", "PPT", "表达", "答辩", "逻辑"])) {
    return "路演表达";
  }

  return "其他";
}

function getCommentRelevance(
  comment: Pick<ExpertCommentRecord, "projectField">,
  projectField: string,
) {
  if (comment.projectField === projectField) {
    return {
      priority: 0,
      reason: "projectField 与项目 field 完全匹配",
    };
  }

  if (comment.projectField === null) {
    return {
      priority: 1,
      reason: "通用专家评语",
    };
  }

  return {
    priority: 2,
    reason: "其他领域补充",
  };
}

function isMeaninglessComment(commentText: string) {
  const compactText = normalizeText(commentText).replace(
    /[，。！？、；：“”‘’"'.,!?;:()[\]{}【】<>《》]/g,
    "",
  );
  const meaninglessTexts = new Set([
    "无",
    "好",
    "一般",
    "暂无",
    "无意见",
    "无建议",
    "没有",
    "无明显问题",
    "无评价",
  ]);

  return meaninglessTexts.has(compactText);
}

function getExpertCommentQuotaBucket(normalizedDimension: string) {
  if (normalizedDimension === "路演表达" || normalizedDimension === "其他") {
    return "路演表达/其他";
  }

  return normalizedDimension as keyof typeof EXPERT_COMMENT_QUOTA_BY_BUCKET;
}

function countBy<T>(items: T[], keyGetter: (item: T) => string) {
  return items.reduce<Record<string, number>>((result, item) => {
    const key = keyGetter(item);
    result[key] = (result[key] ?? 0) + 1;
    return result;
  }, {});
}

function sortExpertCandidates<T extends ExpertCommentRecord>(
  comments: T[],
  projectField: string,
) {
  return comments
    .map((comment) => {
      const relevance = getCommentRelevance(comment, projectField);
      const dimensionText =
        normalizeCommentDimension(comment.dimension) === "其他"
          ? `${comment.dimension} ${comment.commentText.slice(0, 120)}`
          : comment.dimension;

      return {
        ...comment,
        commentText: normalizeLooseText(comment.commentText),
        normalizedDimension: normalizeCommentDimension(dimensionText),
        relevancePriority: relevance.priority,
        relevanceReason: relevance.reason,
      };
    })
    .sort((first, second) => {
      if (first.relevancePriority !== second.relevancePriority) {
        return first.relevancePriority - second.relevancePriority;
      }

      return second.createdAt.getTime() - first.createdAt.getTime();
    });
}

function selectExpertComments(
  comments: ExpertCommentRecord[],
  projectField: string,
) {
  const totalAvailable = comments.length;
  const meaningfulComments = comments.filter((comment) => {
    if (!comment.commentText?.trim()) {
      return false;
    }

    return !isMeaninglessComment(comment.commentText);
  });
  const sortedCandidates = sortExpertCandidates(
    meaningfulComments,
    projectField,
  );
  const highQualityCandidates = sortedCandidates.filter(
    (comment) =>
      countNonWhitespaceChars(comment.commentText) >= MIN_EXPERT_COMMENT_LENGTH,
  );
  const fallbackCandidates = sortedCandidates.filter(
    (comment) =>
      countNonWhitespaceChars(comment.commentText) < MIN_EXPERT_COMMENT_LENGTH,
  );
  const selected: SelectedExpertComment[] = [];
  const selectedIds = new Set<string>();
  const quotaCounts: Record<string, number> = {};
  let longCommentCount = 0;

  const trySelect = (candidate: (typeof sortedCandidates)[number]) => {
    if (selected.length >= MAX_EXPERT_COMMENTS || selectedIds.has(candidate.id)) {
      return;
    }

    const quotaBucket = getExpertCommentQuotaBucket(
      candidate.normalizedDimension,
    );
    const quota = EXPERT_COMMENT_QUOTA_BY_BUCKET[quotaBucket];

    if ((quotaCounts[quotaBucket] ?? 0) >= quota) {
      return;
    }

    const isLongComment =
      countNonWhitespaceChars(candidate.commentText) > LONG_EXPERT_COMMENT_LENGTH;

    if (isLongComment && longCommentCount >= MAX_LONG_EXPERT_COMMENTS) {
      return;
    }

    selected.push(candidate);
    selectedIds.add(candidate.id);
    quotaCounts[quotaBucket] = (quotaCounts[quotaBucket] ?? 0) + 1;

    if (isLongComment) {
      longCommentCount += 1;
    }
  };

  const selectFromCandidates = (candidates: typeof sortedCandidates) => {
    for (const dimension of EXPERT_COMMENT_DIMENSION_ORDER) {
      for (const candidate of candidates) {
        if (candidate.normalizedDimension === dimension) {
          trySelect(candidate);
        }
      }
    }
  };

  selectFromCandidates(highQualityCandidates);

  if (selected.length < MAX_EXPERT_COMMENTS) {
    selectFromCandidates(fallbackCandidates);
  }

  return {
    comments: selected,
    debug: {
      totalAvailable,
      selected: selected.length,
      byNormalizedDimension: countBy(
        selected,
        (item) => item.normalizedDimension,
      ),
      truncated: totalAvailable > selected.length,
    },
  };
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

function selectHistoricalQuestions(
  questions: HistoricalQuestionRecord[],
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
  const selected: HistoricalQuestionRecord[] = [];
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

export async function buildProjectAIContext(
  projectId: string,
): Promise<ProjectAIContext> {
  const project = await prisma.project.findUnique({
    where: {
      id: projectId,
    },
    include: {
      fileAssets: {
        where: {
          parseStatus: "SUCCESS",
          extractedText: {
            not: null,
          },
          includeInAIContext: true,
        },
        orderBy: {
          createdAt: "asc",
        },
        select: {
          id: true,
          originalName: true,
          fileType: true,
          includeInAIContext: true,
          extractedText: true,
        },
      },
      _count: {
        select: {
          fileAssets: true,
        },
      },
    },
  });

  if (!project) {
    throw new ProjectContextNotFoundError(projectId);
  }

  const [rule, expertCommentSelection, historicalQuestionSelection] =
    await Promise.all([
    findEvaluationRule(),
    findExpertComments(project.field),
    findHistoricalQuestions(project.field),
    ]);

  const fileTextResult = takeFileTexts(project.fileAssets);
  const [parsedSuccessFiles, excludedFiles] = await Promise.all([
    prisma.fileAsset.count({
      where: {
        projectId: project.id,
        parseStatus: "SUCCESS",
      },
    }),
    prisma.fileAsset.count({
      where: {
        projectId: project.id,
        parseStatus: "SUCCESS",
        includeInAIContext: false,
      },
    }),
  ]);

  const truncated = {
    files: fileTextResult.filesTruncated,
    allFilesText: fileTextResult.allFilesTextTruncated,
    expertComments: expertCommentSelection.debug.truncated,
    historicalQuestions: historicalQuestionSelection.debug.truncated,
  };

  return {
    project: {
      id: project.id,
      name: project.name,
      field: project.field,
      stage: project.stage,
      summary: project.summary,
      coreTechnology: project.coreTechnology,
      applicationScenario: project.applicationScenario,
      businessModel: project.businessModel,
      cooperationDemand: project.cooperationDemand,
    },
    files: fileTextResult.files,
    evaluationRule: rule
      ? {
          id: rule.id,
          name: rule.name,
          contestName: rule.contestName,
          version: rule.version,
          totalScore: rule.totalScore,
          description: rule.description,
          rawText: rule.rawText,
        }
      : null,
    criteria:
      rule?.criteria.map((criterion) => ({
        id: criterion.id,
        category: criterion.category,
        name: criterion.name,
        weight: criterion.weight,
        description: criterion.description,
        scoringGuide: criterion.scoringGuide,
        sortOrder: criterion.sortOrder,
      })) ?? [],
    expertComments: expertCommentSelection.comments.map((item) => ({
      id: item.id,
      contestName: item.contestName,
      projectField: item.projectField,
      dimension: item.dimension,
      normalizedDimension: item.normalizedDimension,
      commentText: item.commentText,
      problemType: item.problemType,
      suggestionType: item.suggestionType,
      scoreRange: item.scoreRange,
      relevanceReason: item.relevanceReason,
    })),
    historicalQuestions: historicalQuestionSelection.questions.map((item) => ({
        id: item.id,
        contestName: item.contestName,
        projectField: item.projectField,
        perspective: item.perspective,
        questionText: item.questionText,
        focus: item.focus,
      })),
    limits: {
      maxSingleFileTextLength: MAX_SINGLE_FILE_TEXT_LENGTH,
      maxAllFilesTextLength: MAX_ALL_FILES_TEXT_LENGTH,
      maxExpertComments: MAX_EXPERT_COMMENTS,
      maxHistoricalQuestions: MAX_HISTORICAL_QUESTIONS,
    },
    truncated: {
      any: Object.values(truncated).some(Boolean),
      ...truncated,
    },
    debug: {
      fileSelection: {
        totalFiles: project._count.fileAssets,
        parsedSuccessFiles,
        includedFiles: fileTextResult.files.length,
        excludedFiles,
      },
      expertCommentSelection: expertCommentSelection.debug,
      historicalQuestionSelection: historicalQuestionSelection.debug,
    },
  };
}
