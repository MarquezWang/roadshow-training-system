import { mkdir, stat } from "fs/promises";
import path from "path";

import { MAX_PREVIEW_PDF_BYTES } from "./constants";
import { PowerPointPreviewError } from "./errors";
import { runLibreOfficeConvert } from "./libreoffice-convert";

export async function convertPowerPointToPdf(
  inputPath: string,
  outputDir: string,
) {
  await mkdir(outputDir, { recursive: true });

  try {
    const inputStat = await stat(inputPath);

    if (!inputStat.isFile()) {
      throw new PowerPointPreviewError(
        "input_file_not_found",
        "PPT 展示预览生成失败：输入文件不存在。",
      );
    }
  } catch (error) {
    if (error instanceof PowerPointPreviewError) {
      throw error;
    }

    throw new PowerPointPreviewError(
      "input_file_not_found",
      "PPT 展示预览生成失败：输入文件不存在。",
    );
  }

  await runLibreOfficeConvert(inputPath, outputDir);

  const inputExtension = path.extname(inputPath);
  const convertedPath = path.join(
    outputDir,
    `${path.basename(inputPath, inputExtension)}.pdf`,
  );

  try {
    const convertedStat = await stat(convertedPath);
    if (
      !convertedStat.isFile() ||
      convertedStat.size === 0 ||
      convertedStat.size > MAX_PREVIEW_PDF_BYTES
    ) {
      throw new PowerPointPreviewError(
        "output_pdf_not_generated",
        "PPT 展示预览生成失败：未找到转换后的 PDF 文件。",
      );
    }
  } catch (error) {
    if (error instanceof PowerPointPreviewError) {
      throw error;
    }

    throw new PowerPointPreviewError(
      "output_pdf_not_generated",
      "PPT 展示预览生成失败：未找到转换后的 PDF 文件。",
    );
  }

  return convertedPath;
}
