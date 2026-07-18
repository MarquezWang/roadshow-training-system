export type PowerPointPreviewErrorReason =
  | "libreoffice_unavailable"
  | "libreoffice_execution_failed"
  | "input_file_not_found"
  | "output_pdf_not_generated"
  | "unknown";

export class PowerPointPreviewError extends Error {
  constructor(
    readonly reason: PowerPointPreviewErrorReason,
    message: string,
  ) {
    super(message);
    this.name = "PowerPointPreviewError";
  }
}

export function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

export function getPreviewErrorReason(
  error: unknown,
): PowerPointPreviewErrorReason {
  return error instanceof PowerPointPreviewError ? error.reason : "unknown";
}
