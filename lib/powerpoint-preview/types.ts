export type FileAssetForPreview = {
  id: string;
  projectId: string;
  originalName: string;
  fileType: string;
  filePath: string;
};

export type PreviewStatus =
  | "NONE"
  | "PENDING"
  | "FINALIZING"
  | "READY"
  | "FAILED";

export type LibreOfficeCheckResult =
  | {
      available: true;
      command: string;
      version: string;
    }
  | {
      available: false;
      reason: string;
      errors: string[];
    };
