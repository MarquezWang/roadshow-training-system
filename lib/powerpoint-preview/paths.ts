import path from "path";

function sanitizePathSegment(segment: string) {
  return segment.replace(/[^a-zA-Z0-9_-]/g, "");
}

export function assertSafeProjectUploadPath(filePath: string) {
  const normalizedPath = filePath.replaceAll("\\", "/");
  const uploadPrefix = "uploads/projects/";

  if (!normalizedPath.startsWith(uploadPrefix)) {
    throw new Error("INVALID_UPLOAD_PATH");
  }

  const projectsUploadsRoot = path.resolve(
    /*turbopackIgnore: true*/ process.cwd(),
    "uploads",
    "projects",
  );
  const relativeProjectPath = normalizedPath.slice(uploadPrefix.length);
  const absolutePath = path.resolve(projectsUploadsRoot, relativeProjectPath);
  const relativeToProjectsUploads = path.relative(
    projectsUploadsRoot,
    absolutePath,
  );

  if (
    relativeToProjectsUploads.startsWith("..") ||
    path.isAbsolute(relativeToProjectsUploads)
  ) {
    throw new Error("INVALID_UPLOAD_PATH");
  }

  return absolutePath;
}

export function getPreviewPdfRelativePath(projectId: string, fileId: string) {
  return path
    .join(
      "uploads",
      "projects",
      sanitizePathSegment(projectId),
      "previews",
      `${sanitizePathSegment(fileId) || "preview"}.pdf`,
    )
    .replaceAll(path.sep, "/");
}
