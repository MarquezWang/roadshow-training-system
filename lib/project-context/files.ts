export const MAX_SINGLE_FILE_TEXT_LENGTH = 20_000;
export const MAX_ALL_FILES_TEXT_LENGTH = 60_000;

export type ProjectContextFileRecord = {
  id: string;
  originalName: string;
  fileType: string;
  includeInAIContext: boolean;
  extractedText: string | null;
};

export function takeProjectContextFileTexts(
  files: ProjectContextFileRecord[],
) {
  let remaining = MAX_ALL_FILES_TEXT_LENGTH;
  let fileTruncated = false;
  let allFilesTextTruncated = false;

  const result = [];

  for (const file of files) {
    if (!file.extractedText || remaining <= 0) {
      allFilesTextTruncated = true;
      continue;
    }

    const singleFileText = file.extractedText.slice(
      0,
      MAX_SINGLE_FILE_TEXT_LENGTH,
    );
    const truncatedBySingleLimit =
      file.extractedText.length > MAX_SINGLE_FILE_TEXT_LENGTH;
    const text = singleFileText.slice(0, remaining);
    const truncatedByTotalLimit = singleFileText.length > remaining;

    remaining -= text.length;
    fileTruncated =
      fileTruncated || truncatedBySingleLimit || truncatedByTotalLimit;
    allFilesTextTruncated =
      allFilesTextTruncated || truncatedByTotalLimit || remaining <= 0;

    result.push({
      id: file.id,
      originalName: file.originalName,
      fileType: file.fileType,
      includeInAIContext: file.includeInAIContext,
      extractedText: text,
      truncated: truncatedBySingleLimit || truncatedByTotalLimit,
    });
  }

  return {
    files: result,
    filesTruncated: fileTruncated,
    allFilesTextTruncated,
  };
}
