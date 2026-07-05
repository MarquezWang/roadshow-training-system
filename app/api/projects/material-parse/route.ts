import { parseUploadedFileToText } from "@/lib/file-parser";
import {
  InitialProjectMaterialValidationError,
  validateInitialProjectMaterial,
} from "@/lib/file-upload";
import { isAuthEnabled } from "@/lib/auth";
import { getCurrentAuthUser } from "@/lib/auth-server";

const SYSTEM_FAILURE_MESSAGE =
  "材料解析失败，请更换文件或手动填写项目档案。";
const EMPTY_TEXT_MESSAGE =
  "未能从文件中提取到可读取文字。请确认 PDF 不是扫描件/图片版，或改传 PPTX、DOCX、TXT。";
const PARSE_TIMEOUT_MESSAGE =
  "材料解析超时，请尝试改传 PPTX、DOCX、TXT，或手动填写项目档案。";
const IS_DEVELOPMENT = process.env.NODE_ENV === "development";
const PARSE_TIMEOUT_MS = 60_000;

export const runtime = "nodejs";

class MaterialParseTimeoutError extends Error {
  constructor() {
    super(PARSE_TIMEOUT_MESSAGE);
    this.name = "MaterialParseTimeoutError";
  }
}

function debugLog(stage: string, details: unknown) {
  if (IS_DEVELOPMENT) {
    console.info(`[project-material-parse] ${stage}`, details);
  }
}

function infoLog(stage: string, details: unknown) {
  console.info(`[project-material-parse] ${stage}`, details);
}

function errorLog(stage: string, details: unknown) {
  console.error(`[project-material-parse] ${stage}`, details);
}

function getErrorDetails(error: unknown) {
  return {
    message: error instanceof Error ? error.message : String(error),
    stack: error instanceof Error ? error.stack : undefined,
  };
}

function getFileType(fileName: string) {
  const lowerName = fileName.toLowerCase();

  if (lowerName.endsWith(".pdf")) return "pdf";
  if (lowerName.endsWith(".ppt")) return "ppt";
  if (lowerName.endsWith(".pptx")) return "pptx";
  if (lowerName.endsWith(".docx")) return "docx";
  if (lowerName.endsWith(".txt")) return "txt";

  return "unknown";
}

function getFailureMessage(error: unknown) {
  if (error instanceof MaterialParseTimeoutError) {
    return PARSE_TIMEOUT_MESSAGE;
  }

  const message = error instanceof Error ? error.message : String(error);

  if (message.includes("未能从文件中提取到有效文本")) {
    return EMPTY_TEXT_MESSAGE;
  }

  return SYSTEM_FAILURE_MESSAGE;
}

async function parseUploadedFileToTextWithTimeout(file: File) {
  let timeoutId: ReturnType<typeof setTimeout> | null = null;
  const parsePromise = parseUploadedFileToText(file);
  parsePromise.catch(() => undefined);

  try {
    return await Promise.race([
      parsePromise,
      new Promise<never>((_, reject) => {
        timeoutId = setTimeout(() => {
          reject(new MaterialParseTimeoutError());
        }, PARSE_TIMEOUT_MS);
      }),
    ]);
  } finally {
    if (timeoutId !== null) {
      clearTimeout(timeoutId);
    }
  }
}

export async function POST(request: Request) {
  infoLog("request_started", {
    contentLength: request.headers.get("content-length"),
    contentType: request.headers.get("content-type"),
    isProduction: process.env.NODE_ENV === "production",
  });

  if (isAuthEnabled() && !(await getCurrentAuthUser())) {
    return Response.json(
      { status: "unauthorized", message: "请先登录后再使用该功能。" },
      { status: 401 },
    );
  }

  try {
    const formData = await request.formData();
    const materials = formData
      .getAll("materials")
      .filter(
        (value): value is File =>
          value instanceof File && value.size > 0 && value.name.trim() !== "",
      );
    infoLog("formdata_parsed", {
      materialCount: materials.length,
    });

    const material = validateInitialProjectMaterial(materials);
    const fileType = getFileType(material.name);
    let extractedText = "";

    infoLog("file_received", {
      fileName: material.name,
      fileType,
      fileSize: material.size,
    });

    try {
      infoLog("parse_started", {
        fileName: material.name,
        fileType,
        fileSize: material.size,
        timeoutMs: PARSE_TIMEOUT_MS,
      });
      extractedText = await parseUploadedFileToTextWithTimeout(material);
    } catch (error) {
      errorLog("parse_error", {
        fileName: material.name,
        fileType,
        fileSize: material.size,
        ...getErrorDetails(error),
      });

      if (fileType !== "ppt") {
        throw error;
      }

      debugLog("legacy_ppt_parse_skipped", {
        fileName: material.name,
        error: error instanceof Error ? error.message : String(error),
      });
    }

    infoLog("parse_succeeded", {
      fileName: material.name,
      fileType,
      fileSize: material.size,
      extractedTextLength: extractedText.length,
    });

    return Response.json({
      status: "parsed",
      material: {
        fileName: material.name,
        fileType,
        extractedText,
      },
    });
  } catch (error) {
    errorLog("request_failed", getErrorDetails(error));

    if (error instanceof InitialProjectMaterialValidationError) {
      return Response.json(
        {
          status: "validation_error",
          message: error.message,
        },
        { status: 400 },
      );
    }

    return Response.json(
      {
        status: "failed",
        message: getFailureMessage(error),
      },
      { status: 422 },
    );
  }
}
