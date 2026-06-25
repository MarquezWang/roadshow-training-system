import { parseUploadedFileToText } from "@/lib/file-parser";
import {
  InitialProjectMaterialValidationError,
  validateInitialProjectMaterial,
} from "@/lib/file-upload";

const SYSTEM_FAILURE_MESSAGE =
  "材料解析失败，请更换文件或手动填写项目档案。";
const IS_DEVELOPMENT = process.env.NODE_ENV === "development";

function debugLog(stage: string, details: unknown) {
  if (IS_DEVELOPMENT) {
    console.info(`[project-material-parse] ${stage}`, details);
  }
}

export async function POST(request: Request) {
  try {
    const formData = await request.formData();
    const materials = formData
      .getAll("materials")
      .filter(
        (value): value is File =>
          value instanceof File && value.size > 0 && value.name.trim() !== "",
      );
    const material = validateInitialProjectMaterial(materials);
    const lowerName = material.name.toLowerCase();
    const fileType = lowerName.endsWith(".pdf")
      ? "pdf"
      : lowerName.endsWith(".ppt")
        ? "ppt"
        : "pptx";
    let extractedText = "";

    try {
      extractedText = await parseUploadedFileToText(material);
    } catch (error) {
      if (fileType !== "ppt") {
        throw error;
      }

      debugLog("legacy_ppt_parse_skipped", {
        fileName: material.name,
        error: error instanceof Error ? error.message : String(error),
      });
    }

    debugLog("parse_succeeded", {
      fileName: material.name,
      fileType,
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
    debugLog("parse_failed", {
      error: error instanceof Error ? error.message : String(error),
    });

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
        message: SYSTEM_FAILURE_MESSAGE,
      },
      { status: 422 },
    );
  }
}
