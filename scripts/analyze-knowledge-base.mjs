import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

function sumByCategory(criteria) {
  return criteria.reduce((result, criterion) => {
    const category = criterion.category ?? "未分类";
    result[category] = (result[category] ?? 0) + criterion.weight;
    return result;
  }, {});
}

function countBy(items, keyGetter) {
  return items.reduce((result, item) => {
    const key = keyGetter(item) ?? "未填写";
    result[key] = (result[key] ?? 0) + 1;
    return result;
  }, {});
}

function countNonWhitespaceChars(value) {
  return Array.from(value.replace(/\s+/g, "")).length;
}

function countDuplicateComments(comments) {
  const counts = new Map();

  for (const comment of comments) {
    counts.set(comment.commentText, (counts.get(comment.commentText) ?? 0) + 1);
  }

  let duplicateTextCount = 0;
  let duplicateRows = 0;

  for (const count of counts.values()) {
    if (count > 1) {
      duplicateTextCount += 1;
      duplicateRows += count - 1;
    }
  }

  return {
    duplicateTextCount,
    duplicateRows,
  };
}

function sampleCommentsByDimension(comments) {
  const samples = {};

  for (const comment of comments) {
    const dimension = comment.dimension || "未填写";

    if (!samples[dimension]) {
      samples[dimension] = [];
    }

    if (samples[dimension].length < 3) {
      samples[dimension].push({
        id: comment.id,
        contestName: comment.contestName,
        projectField: comment.projectField,
        commentText: comment.commentText,
      });
    }
  }

  return samples;
}

async function main() {
  const [
    evaluationRules,
    expertComments,
    historicalQuestions,
    knowledgeSources,
  ] = await Promise.all([
    prisma.evaluationRule.findMany({
      orderBy: [{ createdAt: "asc" }],
      include: {
        criteria: {
          orderBy: {
            sortOrder: "asc",
          },
        },
      },
    }),
    prisma.expertComment.findMany({
      orderBy: [{ dimension: "asc" }, { createdAt: "asc" }],
      select: {
        id: true,
        contestName: true,
        projectField: true,
        dimension: true,
        commentText: true,
      },
    }),
    prisma.historicalQuestion.findMany({
      select: {
        perspective: true,
      },
    }),
    prisma.knowledgeSource.findMany({
      orderBy: [{ createdAt: "asc" }],
      select: {
        id: true,
        title: true,
        type: true,
        filePath: true,
        status: true,
        updatedAt: true,
      },
    }),
  ]);

  const duplicateComments = countDuplicateComments(expertComments);

  const result = {
    evaluationRules: {
      total: evaluationRules.length,
      items: evaluationRules.map((rule) => ({
        name: rule.name,
        contestName: rule.contestName,
        version: rule.version,
        totalScore: rule.totalScore,
        criteriaCount: rule.criteria.length,
        criteriaWeightTotal: rule.criteria.reduce(
          (sum, criterion) => sum + criterion.weight,
          0,
        ),
        categoryWeightTotals: sumByCategory(rule.criteria),
      })),
    },
    expertComments: {
      total: expertComments.length,
      byContestName: countBy(expertComments, (item) => item.contestName),
      byDimension: countBy(expertComments, (item) => item.dimension),
      tooShortCount: expertComments.filter(
        (item) => countNonWhitespaceChars(item.commentText) < 5,
      ).length,
      duplicateTextCount: duplicateComments.duplicateTextCount,
      duplicateRows: duplicateComments.duplicateRows,
      emptyProjectFieldCount: expertComments.filter(
        (item) => item.projectField === null || item.projectField === "",
      ).length,
      samplesByDimension: sampleCommentsByDimension(expertComments),
    },
    historicalQuestions: {
      total: historicalQuestions.length,
      byPerspective: countBy(historicalQuestions, (item) => item.perspective),
    },
    knowledgeSources: {
      total: knowledgeSources.length,
      byStatus: countBy(knowledgeSources, (item) => item.status),
      items: knowledgeSources,
    },
  };

  console.log(JSON.stringify(result, null, 2));
}

main()
  .catch((error) => {
    console.error(`知识库质量统计失败：${error.message}`);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
