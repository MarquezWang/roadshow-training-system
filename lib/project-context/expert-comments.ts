export const MAX_EXPERT_COMMENTS = 20;

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

export type ExpertCommentRecord = {
  id: string;
  projectField: string | null;
  dimension: string;
  commentText: string;
  createdAt: Date;
};

type SelectedExpertComment<T extends ExpertCommentRecord> = T & {
  normalizedDimension: string;
  relevanceReason: string;
};

type RankedExpertComment<T extends ExpertCommentRecord> =
  SelectedExpertComment<T> & {
    relevancePriority: number;
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
): Array<RankedExpertComment<T>> {
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

export function selectExpertComments<T extends ExpertCommentRecord>(
  comments: T[],
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
  const selected: Array<SelectedExpertComment<T>> = [];
  const selectedIds = new Set<string>();
  const quotaCounts: Record<string, number> = {};
  let longCommentCount = 0;

  const trySelect = (candidate: RankedExpertComment<T>) => {
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

  const selectFromCandidates = (
    candidates: Array<RankedExpertComment<T>>,
  ) => {
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
