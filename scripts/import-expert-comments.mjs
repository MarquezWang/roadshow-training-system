import { PrismaClient } from "@prisma/client";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";

const prisma = new PrismaClient();

const IS_DRY_RUN = process.argv.includes("--dry-run");
const SOURCE_TITLE = "路演大赛历史专家评语 TSV";
const SOURCE_FILE_PATH = "data/raw/export-evaluate-content2026-03-04_20-23-03.tsv";
const RAW_FILE = path.join(process.cwd(), SOURCE_FILE_PATH);
const BATCH_SIZE = 500;

function normalizeCommentText(value) {
  return value.trim().replace(/\s+/g, " ");
}

function countNonWhitespaceChars(value) {
  return Array.from(value.replace(/\s+/g, "")).length;
}

function createEmptyStats() {
  return {
    totalRows: 0,
    emptyRows: 0,
    emptyCommentRows: 0,
    tooShortRows: 0,
    parsedValidRows: 0,
    uniqueValidComments: 0,
    existingRows: 0,
    duplicateInFileRows: 0,
    insertedRows: 0,
    skippedRows: 0,
    dimensionCounts: {},
  };
}

function classifyDimension(text) {
  const rules = [
    ["项目团队", ["团队", "成员", "负责人", "经验", "结构", "稳定", "投入"]],
    ["科技含量", ["技术", "创新", "先进", "指标", "研发", "算法", "系统", "性能"]],
    ["市场机会", ["市场", "客户", "需求", "推广", "竞争", "应用", "场景"]],
    ["知识产权", ["专利", "知识产权", "软著", "壁垒", "保护"]],
    ["转化落地", ["转化", "落地", "产业化", "试点", "实施", "验收"]],
    ["商业模式", ["商业模式", "收入", "盈利", "成本", "价格", "融资", "投资"]],
    ["路演表达", ["路演", "表达", "PPT", "逻辑", "讲解", "答辩"]],
  ];

  for (const [dimension, keywords] of rules) {
    if (keywords.some((keyword) => text.includes(keyword))) {
      return dimension;
    }
  }

  return "其他";
}

function parseExpertCommentRows(content) {
  const stats = createEmptyStats();
  const lines = content.replace(/^\uFEFF/, "").split(/\r?\n/);

  if (lines.length === 0 || lines[0].trim() === "") {
    return {
      headers: [],
      validRows: [],
      uniqueRows: [],
      stats,
    };
  }

  const headers = lines[0].split("\t").map((header) => header.trim());
  const achievementIndex = headers.indexOf("achievement_name");
  const commentIndex = headers.indexOf("evaluate_content");
  const validRows = [];
  const uniqueRows = [];
  const seenInFile = new Set();

  if (achievementIndex === -1 || commentIndex === -1) {
    throw new Error("TSV 文件必须包含 achievement_name 和 evaluate_content 两个字段。");
  }

  for (const line of lines.slice(1)) {
    stats.totalRows += 1;

    if (line.trim() === "") {
      stats.emptyRows += 1;
      continue;
    }

    const columns = line.split("\t");
    const achievementName = (columns[0] ?? "").trim();
    const rawComment =
      columns.length > 2
        ? columns.slice(1).join("\t")
        : columns[commentIndex] ?? "";
    const commentText = normalizeCommentText(rawComment);

    if (!commentText) {
      stats.emptyCommentRows += 1;
      continue;
    }

    if (countNonWhitespaceChars(commentText) < 5) {
      stats.tooShortRows += 1;
      continue;
    }

    const dimension = classifyDimension(`${achievementName} ${commentText}`);
    const row = {
      achievementName,
      dimension,
      commentText,
    };

    stats.parsedValidRows += 1;
    validRows.push(row);

    if (seenInFile.has(commentText)) {
      stats.duplicateInFileRows += 1;
      continue;
    }

    seenInFile.add(commentText);
    uniqueRows.push(row);
    stats.dimensionCounts[dimension] = (stats.dimensionCounts[dimension] ?? 0) + 1;
  }

  stats.uniqueValidComments = uniqueRows.length;

  return {
    headers,
    validRows,
    uniqueRows,
    stats,
  };
}

async function insertInBatches(comments) {
  let insertedRows = 0;

  for (let index = 0; index < comments.length; index += BATCH_SIZE) {
    const batch = comments.slice(index, index + BATCH_SIZE);
    const result = await prisma.expertComment.createMany({ data: batch });
    insertedRows += result.count;
  }

  return insertedRows;
}

async function upsertKnowledgeSource(stats) {
  const rawText = JSON.stringify(
    {
      source: SOURCE_FILE_PATH,
      importedAt: new Date().toISOString(),
      stats,
    },
    null,
    2,
  );

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
        type: "EXPERT_COMMENT",
        status: "PROCESSED",
        rawText,
      },
    });
    return;
  }

  await prisma.knowledgeSource.create({
    data: {
      title: SOURCE_TITLE,
      type: "EXPERT_COMMENT",
      filePath: SOURCE_FILE_PATH,
      rawText,
      status: "PROCESSED",
    },
  });
}

function printResult(stats, samples) {
  console.log(
    JSON.stringify(
      {
        mode: IS_DRY_RUN ? "dry-run" : "import",
        ...stats,
      },
      null,
      2,
    ),
  );

  if (IS_DRY_RUN) {
    console.log("前 5 条解析样例：");
    console.log(JSON.stringify(samples, null, 2));
  }
}

async function main() {
  if (!existsSync(RAW_FILE)) {
    console.log(
      `未找到 TSV 文件：${RAW_FILE}\n请先将原始评语文件放到 data/raw/ 目录后再运行导入脚本。`,
    );
    return;
  }

  const content = await readFile(RAW_FILE, "utf8");
  const { uniqueRows, stats } = parseExpertCommentRows(content);
  const existingComments = new Set(
    (
      await prisma.expertComment.findMany({
        select: { commentText: true },
      })
    ).map((item) => item.commentText),
  );

  const rowsToInsert = [];

  for (const row of uniqueRows) {
    if (existingComments.has(row.commentText)) {
      stats.existingRows += 1;
      continue;
    }

    rowsToInsert.push({
      contestName: "路演大赛历史评语",
      projectField: null,
      dimension: row.dimension,
      commentText: row.commentText,
      problemType: null,
      suggestionType: null,
      scoreRange: null,
    });
  }

  stats.skippedRows =
    stats.emptyRows +
    stats.emptyCommentRows +
    stats.tooShortRows +
    stats.duplicateInFileRows +
    stats.existingRows;

  if (!IS_DRY_RUN) {
    stats.insertedRows = await insertInBatches(rowsToInsert);
    await upsertKnowledgeSource(stats);
  }

  printResult(stats, uniqueRows.slice(0, 5));
}

main()
  .catch((error) => {
    console.error(`专家评语导入失败：${error.message}`);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
