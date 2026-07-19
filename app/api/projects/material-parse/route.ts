import {
  InitialProjectMaterialValidationError,
} from "@/lib/file-upload";
import { isAuthEnabled } from "@/lib/auth";
import { getCurrentAuthUser } from "@/lib/auth-server";
import {
  cleanupExpiredProjectMaterials,
  stageAndParseProjectMaterial,
} from "@/lib/project-material-staging";
import { UploadStreamError } from "@/lib/stream-upload.mjs";

const SYSTEM_FAILURE_MESSAGE =
  "材料解析失败，请更换文件或手动填写项目档案。";
const EMPTY_TEXT_MESSAGE =
  "未能从文件中提取到可读取文字。请确认 PDF 不是扫描件/图片版，或改传 PPTX、DOCX、TXT。";
const PARSE_TIMEOUT_MESSAGE =
  "材料解析超时，请尝试改传 PPTX、DOCX、TXT，或手动填写项目档案。";
const RAW_MATERIAL_UPLOAD_VERSION = "raw-v1";

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

function readOriginalName(value: string | null) {
  if (!value) {
    throw new InitialProjectMaterialValidationError(
      "缺少材料文件名，请重新选择文件。",
    );
  }

  try {
    const decoded = decodeURIComponent(value).trim().replaceAll("\\", "/");
    const originalName = decoded.split("/").at(-1)?.trim() ?? "";
    if (!originalName) throw new Error("empty");
    return originalName;
  } catch {
    throw new InitialProjectMaterialValidationError(
      "材料文件名无效，请重新选择文件。",
    );
  }
}

function readExpectedBytes(request: Request) {
  const raw =
    request.headers.get("x-material-size") ??
    request.headers.get("content-length");
  const expectedBytes = Number(raw);

  if (!Number.isSafeInteger(expectedBytes) || expectedBytes <= 0) {
    throw new InitialProjectMaterialValidationError(
      "材料文件大小声明无效，请重新上传。",
    );
  }

  return expectedBytes;
}

function streamFailureResponse(error: UploadStreamError) {
  if (error.code === "TOO_LARGE") {
    return Response.json(
      { status: "validation_error", message: "文件大小不能超过 50MB。" },
      { status: 413 },
    );
  }
  if (error.code === "EMPTY") {
    return Response.json(
      { status: "validation_error", message: "材料文件为空。" },
      { status: 400 },
    );
  }
  if (error.code === "SIZE_MISMATCH") {
    return Response.json(
      { status: "validation_error", message: "材料上传不完整，请重新上传。" },
      { status: 400 },
    );
  }

  return Response.json(
    { status: "failed", message: SYSTEM_FAILURE_MESSAGE },
    { status: 422 },
  );
}

export async function POST(request: Request) {
  infoLog("request_started", {
    contentLength: request.headers.get("content-length"),
    contentType: request.headers.get("content-type"),
    isProduction: process.env.NODE_ENV === "production",
  });

  const currentUser = await getCurrentAuthUser();
  if (isAuthEnabled() && !currentUser) {
    return Response.json(
      { status: "unauthorized", message: "请先登录后再使用该功能。" },
      { status: 401 },
    );
  }

  try {
    if (
      request.headers.get("x-material-upload") !== RAW_MATERIAL_UPLOAD_VERSION
    ) {
      return Response.json(
        {
          status: "validation_error",
          message: "材料上传协议已更新，请刷新页面后重试。",
        },
        { status: 415 },
      );
    }

    await cleanupExpiredProjectMaterials().catch((error) =>
      errorLog("cleanup_failed", getErrorDetails(error)),
    );
    const originalName = readOriginalName(
      request.headers.get("x-material-name"),
    );
    const expectedBytes = readExpectedBytes(request);
    const staged = await stageAndParseProjectMaterial({
      body: request.body,
      originalName,
      expectedBytes,
      ownerId: currentUser?.id ?? null,
      signal: request.signal,
    });

    infoLog(staged.parseStatus === "SUCCESS" ? "parse_succeeded" : "parse_failed", {
      fileName: originalName,
      fileType: staged.fileType,
      fileSize: expectedBytes,
      extractedTextLength: staged.extractedText?.length ?? 0,
    });

    const responseMaterial = {
      materialToken: staged.id,
      fileName: staged.originalName,
      fileType: staged.fileType,
    };

    if (staged.parseStatus !== "SUCCESS" || !staged.extractedText?.trim()) {
      return Response.json(
        {
          status: "parse_failed",
          message: getFailureMessage(staged.parseError ?? "文件解析失败。"),
          material: responseMaterial,
        },
        { status: 422 },
      );
    }

    return Response.json({
      status: "parsed",
      material: responseMaterial,
    });
  } catch (error) {
    errorLog("request_failed", getErrorDetails(error));

    if (error instanceof UploadStreamError) {
      return streamFailureResponse(error);
    }

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
