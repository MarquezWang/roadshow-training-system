import path from "path";

export function isPowerPointFile(file: {
  fileType: string;
  originalName?: string;
}) {
  const normalizedType = file.fileType.toLowerCase().replace(/^\./, "");
  if (normalizedType === "ppt" || normalizedType === "pptx") {
    return true;
  }

  const extension = path.extname(file.originalName ?? "").toLowerCase();
  return extension === ".ppt" || extension === ".pptx";
}

export function isPdfFile(file: {
  fileType: string;
  originalName?: string;
}) {
  const normalizedType = file.fileType.toLowerCase().replace(/^\./, "");
  if (normalizedType === "pdf") {
    return true;
  }

  return path.extname(file.originalName ?? "").toLowerCase() === ".pdf";
}
