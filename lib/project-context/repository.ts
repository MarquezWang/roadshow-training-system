import { prisma } from "@/lib/prisma";

import { selectExpertComments } from "./expert-comments";
import { selectHistoricalQuestions } from "./historical-questions";

const REAL_RULE_NAME = "路演大赛真实评审规则";
const DEFAULT_RULE_NAME = "路演大赛通用评审规则";

export function findProjectContextProject(projectId: string) {
  return prisma.project.findUnique({
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
}

export async function findEvaluationRule() {
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

export async function findExpertComments(projectField: string) {
  const comments = await prisma.expertComment.findMany({
    orderBy: {
      createdAt: "desc",
    },
  });

  return selectExpertComments(comments, projectField);
}

export async function findHistoricalQuestions(projectField: string) {
  const questions = await prisma.historicalQuestion.findMany({
    orderBy: {
      createdAt: "asc",
    },
  });

  return selectHistoricalQuestions(questions, projectField);
}

export function countProjectContextFiles(projectId: string) {
  return Promise.all([
    prisma.fileAsset.count({
      where: {
        projectId,
        parseStatus: "SUCCESS",
      },
    }),
    prisma.fileAsset.count({
      where: {
        projectId,
        parseStatus: "SUCCESS",
        includeInAIContext: false,
      },
    }),
  ]);
}
