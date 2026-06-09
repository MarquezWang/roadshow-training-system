import { PrismaClient } from "@prisma/client";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";

const prisma = new PrismaClient();

const SOURCE_TITLE = "路演大赛真实评审规则 JSON";
const SOURCE_FILE_PATH = "data/knowledge/rules/roadshow-review-rule-100.json";
const RULE_FILE = path.join(process.cwd(), SOURCE_FILE_PATH);

function assertString(value, fieldName) {
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`${fieldName} 必须是非空字符串。`);
  }

  return value.trim();
}

function assertNumber(value, fieldName) {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`${fieldName} 必须是数字。`);
  }

  return value;
}

function validateRule(rule) {
  const name = assertString(rule.name, "name");
  const contestName = assertString(rule.contestName, "contestName");
  const version = assertString(rule.version, "version");
  const totalScore = assertNumber(rule.totalScore, "totalScore");

  if (totalScore !== 100) {
    throw new Error(`totalScore 必须等于 100，当前为 ${totalScore}。`);
  }

  if (!Array.isArray(rule.criteria) || rule.criteria.length === 0) {
    throw new Error("criteria 必须是非空数组。");
  }

  const criteria = rule.criteria.map((criterion, index) => ({
    category:
      typeof criterion.category === "string" && criterion.category.trim()
        ? criterion.category.trim()
        : null,
    name: assertString(criterion.name, `criteria[${index}].name`),
    weight: assertNumber(criterion.weight, `criteria[${index}].weight`),
    description: assertString(
      criterion.description,
      `criteria[${index}].description`,
    ),
    scoringGuide:
      typeof criterion.scoringGuide === "string" &&
      criterion.scoringGuide.trim()
        ? criterion.scoringGuide.trim()
        : null,
    sortOrder: assertNumber(criterion.sortOrder, `criteria[${index}].sortOrder`),
  }));

  const criteriaWeightTotal = criteria.reduce(
    (sum, criterion) => sum + criterion.weight,
    0,
  );

  if (criteriaWeightTotal !== 100) {
    throw new Error(`criteria weight 总和必须等于 100，当前为 ${criteriaWeightTotal}。`);
  }

  return {
    name,
    contestName,
    version,
    totalScore,
    description:
      typeof rule.description === "string" && rule.description.trim()
        ? rule.description.trim()
        : null,
    rawText:
      typeof rule.rawText === "string" && rule.rawText.trim()
        ? rule.rawText.trim()
        : JSON.stringify(rule, null, 2),
    criteria,
    criteriaWeightTotal,
  };
}

async function upsertKnowledgeSource(summary) {
  const rawText = JSON.stringify(summary, null, 2);
  const existingSource = await prisma.knowledgeSource.findFirst({
    where: {
      title: SOURCE_TITLE,
      filePath: SOURCE_FILE_PATH,
    },
  });

  if (existingSource) {
    await prisma.knowledgeSource.update({
      where: { id: existingSource.id },
      data: {
        type: "REVIEW_RULE",
        status: "PROCESSED",
        rawText,
      },
    });
    return;
  }

  await prisma.knowledgeSource.create({
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

  const rule = validateRule(parsedRule);
  const existingRule = await prisma.evaluationRule.findFirst({
    where: {
      name: rule.name,
      version: rule.version,
    },
  });

  const savedRule = existingRule
    ? await prisma.evaluationRule.update({
        where: { id: existingRule.id },
        data: {
          contestName: rule.contestName,
          totalScore: rule.totalScore,
          description: rule.description,
          rawText: rule.rawText,
        },
      })
    : await prisma.evaluationRule.create({
        data: {
          name: rule.name,
          contestName: rule.contestName,
          version: rule.version,
          totalScore: rule.totalScore,
          description: rule.description,
          rawText: rule.rawText,
        },
      });

  await prisma.evaluationCriterion.deleteMany({
    where: {
      ruleId: savedRule.id,
    },
  });

  await prisma.evaluationCriterion.createMany({
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

  await upsertKnowledgeSource(summary);

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
