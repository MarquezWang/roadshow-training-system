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

export const runtime = "nodejs";

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
  if (lowerName.endsWith(".pptx")) return "pptx";
  if (lowerName.endsWith(".docx")) return "docx";
  if (lowerName.endsWith(".txt")) return "txt";

  return "unknown";
}

function getFailureMessage(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);

  if (message.includes("解析超过") || message.includes("解析任务拥堵")) {
    return PARSE_TIMEOUT_MESSAGE;
  }

  if (message.includes("未能从文件中提取到有效文本")) {
    return EMPTY_TEXT_MESSAGE;
  }

  return SYSTEM_FAILURE_MESSAGE;
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
      });
      extractedText = await parseUploadedFileToText(material);
    } catch (error) {
      errorLog("parse_error", {
        fileName: material.name,
        fileType,
        fileSize: material.size,
        ...getErrorDetails(error),
      });

      throw error;
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
