import { PrismaClient } from "@prisma/client";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { validateEvaluationRule } from "../lib/review-rule-validation.mjs";

const prisma = new PrismaClient();

const SOURCE_TITLE = "路演大赛真实评审规则 JSON";
const SOURCE_FILE_PATH = "data/knowledge/rules/roadshow-review-rule-100.json";
const RULE_FILE = path.join(process.cwd(), SOURCE_FILE_PATH);

async function upsertKnowledgeSource(client, summary) {
  const rawText = JSON.stringify(summary, null, 2);
  const existingSource = await client.knowledgeSource.findFirst({
    where: {
      title: SOURCE_TITLE,
      filePath: SOURCE_FILE_PATH,
    },
  });

  if (existingSource) {
    await client.knowledgeSource.update({
      where: { id: existingSource.id },
      data: {
        type: "REVIEW_RULE",
        status: "PROCESSED",
        rawText,
      },
    });
    return;
  }

  await client.knowledgeSource.create({
    data: {
      title: SOURCE_TITLE,
      type: "REVIEW_RULE",
      filePath: SOURCE_FILE_PATH,
      status: "PROCESSED",
      rawText,
    },
  });
}

async function main() {
  if (!existsSync(RULE_FILE)) {
    console.log(`未找到真实评审规则文件：${RULE_FILE}`);
    return;
  }

  let parsedRule;

  try {
    parsedRule = JSON.parse(await readFile(RULE_FILE, "utf8"));
  } catch (error) {
    throw new Error(`评审规则 JSON 格式不合法：${error.message}`);
  }

  const rule = validateEvaluationRule(parsedRule);

  const summary = {
    ruleName: rule.name,
    contestName: rule.contestName,
    version: rule.version,
    totalScore: rule.totalScore,
    criteriaCount: rule.criteria.length,
    criteriaWeightTotal: rule.criteriaWeightTotal,
    totalScoreValid: rule.totalScore === 100,
    criteriaWeightValid: rule.criteriaWeightTotal === 100,
    importedAt: new Date().toISOString(),
  };

  await prisma.$transaction(async (transaction) => {
    const savedRule = await transaction.evaluationRule.upsert({
      where: {
        contestName_version: {
          contestName: rule.contestName,
          version: rule.version,
        },
      },
      update: {
        name: rule.name,
        totalScore: rule.totalScore,
        description: rule.description,
        rawText: rule.rawText,
      },
      create: {
        name: rule.name,
        contestName: rule.contestName,
        version: rule.version,
        totalScore: rule.totalScore,
        description: rule.description,
        rawText: rule.rawText,
      },
    });

    await transaction.evaluationCriterion.deleteMany({
      where: { ruleId: savedRule.id },
    });
    await transaction.evaluationCriterion.createMany({
      data: rule.criteria.map((criterion) => ({
        ruleId: savedRule.id,
        category: criterion.category,
        name: criterion.name,
        weight: criterion.weight,
        description: criterion.description,
        scoringGuide: criterion.scoringGuide,
        sortOrder: criterion.sortOrder,
      })),
    });
    await upsertKnowledgeSource(transaction, summary);
  });

  console.log(JSON.stringify(summary, null, 2));
}

main()
  .catch((error) => {
    console.error(`真实评审规则导入失败：${error.message}`);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
