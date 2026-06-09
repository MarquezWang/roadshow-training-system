import { access, readFile } from "fs/promises";
import path from "path";
import { pathToFileURL } from "url";
import mammoth from "mammoth";
import { PDFParse } from "pdf-parse";
import JSZip from "jszip";

const MAX_EXTRACTED_TEXT_LENGTH = 100_000;
const SUPPORTED_FILE_TYPES = new Set(["txt", "pdf", "docx", "pptx"]);

function normalizeText(text: string) {
  return text.replace(/\r/g, "").replace(/[ \t]+\n/g, "\n").trim();
}

function limitExtractedText(text: string) {
  return text.length > MAX_EXTRACTED_TEXT_LENGTH
    ? text.slice(0, MAX_EXTRACTED_TEXT_LENGTH)
    : text;
}

async function resolveUploadPath(filePath: string) {
  const normalizedPath = filePath.replaceAll("\\", "/");

  if (!normalizedPath.startsWith("uploads/projects/")) {
    throw new Error("文件路径不在允许的 uploads/projects 目录下。");
  }

  const uploadsRoot = path.resolve(process.cwd(), "uploads");
  const absolutePath = path.resolve(process.cwd(), normalizedPath);
  const relativeToUploads = path.relative(uploadsRoot, absolutePath);

  if (
    relativeToUploads.startsWith("..") ||
    path.isAbsolute(relativeToUploads)
  ) {
    throw new Error("文件路径不在允许的 uploads 目录下。");
  }

  await access(absolutePath);
  return absolutePath;
}

async function parseTxt(absolutePath: string) {
  return readFile(absolutePath, "utf8");
}

async function parsePdf(absolutePath: string) {
  const buffer = await readFile(absolutePath);
  const workerPath = path.join(
    process.cwd(),
    "node_modules",
    "pdfjs-dist",
    "legacy",
    "build",
    "pdf.worker.mjs",
  );

  PDFParse.setWorker(pathToFileURL(workerPath).href);

  const parser = new PDFParse({
    data: new Uint8Array(buffer),
  });

  try {
    const result = await parser.getText();

    return result.text;
  } finally {
    await parser.destroy();
  }
}

async function parseDocx(absolutePath: string) {
  const result = await mammoth.extractRawText({ path: absolutePath });

  return result.value;
}

async function parsePptx(absolutePath: string) {
  const buffer = await readFile(absolutePath);
  const zip = await JSZip.loadAsync(buffer);
  const slideFiles = Object.keys(zip.files)
    .filter((fileName) => /^ppt\/slides\/slide\d+\.xml$/.test(fileName))
    .sort((left, right) =>
      left.localeCompare(right, undefined, { numeric: true }),
    );

  const slideTexts = await Promise.all(
    slideFiles.map(async (fileName) => {
      const xml = await zip.files[fileName].async("text");
      const matches = [...xml.matchAll(/<a:t>([\s\S]*?)<\/a:t>/g)];

      return matches
        .map((match) =>
          match[1]
            .replace(/&lt;/g, "<")
            .replace(/&gt;/g, ">")
            .replace(/&amp;/g, "&")
            .replace(/&quot;/g, '"')
            .replace(/&apos;/g, "'"),
        )
        .join("\n");
    }),
  );

  return slideTexts.join("\n\n");
}

export async function parseFileToText(filePath: string, fileType: string) {
  const normalizedType = fileType.toLowerCase().replace(/^\./, "");

  if (!SUPPORTED_FILE_TYPES.has(normalizedType)) {
    throw new Error(`暂不支持解析 ${fileType} 文件。`);
  }

  let absolutePath: string;

  try {
    absolutePath = await resolveUploadPath(filePath);
  } catch (error) {
    if (error instanceof Error) {
      throw new Error(`文件不存在或不可读取：${error.message}`);
    }

    throw new Error("文件不存在或不可读取。");
  }

  let extractedText = "";

  if (normalizedType === "txt") {
    extractedText = await parseTxt(absolutePath);
  }

  if (normalizedType === "pdf") {
    extractedText = await parsePdf(absolutePath);
  }

  if (normalizedType === "docx") {
    extractedText = await parseDocx(absolutePath);
  }

  if (normalizedType === "pptx") {
    extractedText = await parsePptx(absolutePath);
  }

  const normalizedText = normalizeText(extractedText);

  if (!normalizedText) {
    throw new Error("未能从文件中提取到有效文本。");
  }

  return limitExtractedText(normalizedText);
}
