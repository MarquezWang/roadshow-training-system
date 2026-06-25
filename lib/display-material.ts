import { isPdfFile, isPowerPointFile } from "@/lib/powerpoint-preview";

export type DisplayMaterialFile = {
  id: string;
  originalName: string;
  fileType: string;
  previewPdfPath: string | null;
  previewStatus: string;
  previewError: string | null;
};

export type DisplayMaterial = DisplayMaterialFile & {
  displaySource: "PDF" | "POWERPOINT_PREVIEW";
};

export type DisplayMaterialNotice = {
  type: "converting" | "failed" | "unavailable";
  message: string;
};

export function getDisplayablePdfForFile(
  file: DisplayMaterialFile,
): DisplayMaterial | null {
  if (isPdfFile(file)) {
    return {
      ...file,
      displaySource: "PDF",
    };
  }

  if (
    isPowerPointFile(file) &&
    file.previewStatus === "READY" &&
    Boolean(file.previewPdfPath)
  ) {
    return {
      ...file,
      displaySource: "POWERPOINT_PREVIEW",
    };
  }

  return null;
}

export function selectDisplayablePdf(
  files: DisplayMaterialFile[],
): DisplayMaterial | null {
  const pdfFile = files.find((file) => isPdfFile(file));
  if (pdfFile) {
    return getDisplayablePdfForFile(pdfFile);
  }

  for (const file of files) {
    const displayableFile = getDisplayablePdfForFile(file);
    if (displayableFile) {
      return displayableFile;
    }
  }

  return null;
}

export function getDisplayMaterialNotice(
  files: DisplayMaterialFile[],
): DisplayMaterialNotice | null {
  const powerPointFiles = files.filter((file) => isPowerPointFile(file));

  if (powerPointFiles.some((file) => file.previewStatus === "PENDING")) {
    return {
      type: "converting",
      message: "正在生成路演展示预览，请稍后刷新。",
    };
  }

  const failedPowerPoint = powerPointFiles.find(
    (file) => file.previewStatus === "FAILED",
  );

  if (failedPowerPoint) {
    return {
      type: "failed",
      message:
        "PPT 展示预览生成失败，但该材料仍可用于 AI 分析。建议上传 PDF 版路演材料或重新转换。",
    };
  }

  if (powerPointFiles.length > 0) {
    return {
      type: "unavailable",
      message:
        "当前 PPT 材料尚未生成路演展示预览。建议上传 PDF 版路演材料，或在服务器配置 PPT 转换组件后重新上传。",
    };
  }

  return null;
}
