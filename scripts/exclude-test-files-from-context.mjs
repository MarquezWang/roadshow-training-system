import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

function isTestFileName(originalName) {
  const name = originalName.toLowerCase();

  if (name.includes("parse-check") || name.includes("upload-check")) {
    return true;
  }

  if (name === "demo.txt" || name === "mode.txt") {
    return true;
  }

  return false;
}

async function main() {
  const files = await prisma.fileAsset.findMany({
    select: {
      id: true,
      originalName: true,
      includeInAIContext: true,
    },
  });
  const filesToExclude = files.filter(
    (file) => file.includeInAIContext && isTestFileName(file.originalName),
  );

  if (filesToExclude.length > 0) {
    await prisma.fileAsset.updateMany({
      where: {
        id: {
          in: filesToExclude.map((file) => file.id),
        },
      },
      data: {
        includeInAIContext: false,
      },
    });
  }

  console.log(
    JSON.stringify(
      {
        scannedFiles: files.length,
        updatedFiles: filesToExclude.length,
        excludedFileNames: filesToExclude.map((file) => file.originalName),
      },
      null,
      2,
    ),
  );
}

main()
  .catch((error) => {
    console.error(`测试文件排除失败：${error.message}`);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
