import { createReadStream } from "fs";
import { stat } from "fs/promises";
import path from "path";
import { Readable } from "stream";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { isPdfFile, isPowerPointFile } from "@/lib/powerpoint-preview";

type FilePreviewRouteContext = Readonly<{
  params: Promise<{
    fileId: string;
  }>;
}>;

type ResolvedRange =
  | {
      valid: true;
      start: number;
      end: number;
    }
  | {
      valid: false;
    };

async function resolveUploadFilePath(filePath: string) {
  const normalizedPath = filePath.replaceAll("\\", "/");
  const uploadPrefix = "uploads/projects/";

  if (!normalizedPath.startsWith(uploadPrefix)) {
    throw new Error("INVALID_UPLOAD_PATH");
  }

  const projectsUploadsRoot = path.join(
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

  const fileStat = await stat(absolutePath);

  if (!fileStat.isFile()) {
    throw new Error("FILE_NOT_FOUND");
  }

  return {
    absolutePath,
    size: fileStat.size,
  };
}

function buildContentDisposition(fileName: string) {
  return `inline; filename*=UTF-8''${encodeURIComponent(fileName)}`;
}

function buildPreviewFileName(fileName: string) {
  const extension = path.extname(fileName);

  if (extension.toLowerCase() === ".pdf") {
    return fileName;
  }

  const baseName = path.basename(fileName, extension);
  return `${baseName || "preview"}.pdf`;
}

function getBaseHeaders(fileName: string, contentLength: number) {
  return {
    "Accept-Ranges": "bytes",
    "Cache-Control": "private, max-age=600",
    "Content-Disposition": buildContentDisposition(fileName),
    "Content-Length": String(contentLength),
    "Content-Type": "application/pdf",
  };
}

function parseRangeHeader(
  rangeHeader: string | null,
  size: number,
): ResolvedRange | null {
  if (!rangeHeader) {
    return null;
  }

  const match = /^bytes=(\d*)-(\d*)$/.exec(rangeHeader.trim());

  if (!match) {
    return { valid: false };
  }

  const [, startValue, endValue] = match;

  if (startValue === "" && endValue === "") {
    return { valid: false };
  }

  if (size <= 0) {
    return { valid: false };
  }

  if (startValue === "") {
    const suffixLength = Number(endValue);

    if (!Number.isSafeInteger(suffixLength) || suffixLength <= 0) {
      return { valid: false };
    }

    const start = Math.max(size - suffixLength, 0);
    return {
      valid: true,
      start,
      end: size - 1,
    };
  }

  const start = Number(startValue);
  const requestedEnd = endValue === "" ? size - 1 : Number(endValue);

  if (
    !Number.isSafeInteger(start) ||
    !Number.isSafeInteger(requestedEnd) ||
    start < 0 ||
    requestedEnd < start ||
    start >= size
  ) {
    return { valid: false };
  }

  return {
    valid: true,
    start,
    end: Math.min(requestedEnd, size - 1),
  };
}

async function buildPreviewResponse(
  request: Request,
  context: FilePreviewRouteContext,
  includeBody: boolean,
) {
  const { fileId } = await context.params;
  const fileAsset = await prisma.fileAsset.findUnique({
    where: {
      id: fileId,
    },
    select: {
      originalName: true,
      fileType: true,
      filePath: true,
      previewPdfPath: true,
      previewStatus: true,
      previewError: true,
    },
  });

  if (!fileAsset) {
    return NextResponse.json({ error: "文件不存在。" }, { status: 404 });
  }

  const isOriginalPdf = isPdfFile(fileAsset);
  const isConvertedPowerPoint =
    isPowerPointFile(fileAsset) &&
    fileAsset.previewStatus === "READY" &&
    Boolean(fileAsset.previewPdfPath);

  if (!isOriginalPdf && !isConvertedPowerPoint) {
    const isPowerPoint = isPowerPointFile(fileAsset);
    const error =
      isPowerPoint && fileAsset.previewStatus === "PENDING"
        ? "正在生成路演展示预览，请稍后刷新。"
        : isPowerPoint && fileAsset.previewStatus === "FAILED"
          ? "PPT 展示预览生成失败，但该材料仍可用于 AI 分析。"
          : "当前文件没有可展示的 PDF 预览。";

    return NextResponse.json(
      {
        error,
        detail: fileAsset.previewError,
      },
      { status: isPowerPoint ? 409 : 415 },
    );
  }

  const previewPath = isOriginalPdf
    ? fileAsset.filePath
    : fileAsset.previewPdfPath;

  if (!previewPath) {
    return NextResponse.json(
      { error: "当前文件没有可展示的 PDF 预览。" },
      { status: 404 },
    );
  }

  try {
    const { absolutePath, size } = await resolveUploadFilePath(previewPath);
    const range = parseRangeHeader(request.headers.get("range"), size);
    const previewFileName = buildPreviewFileName(fileAsset.originalName);

    if (range && !range.valid) {
      return new Response(null, {
        status: 416,
        headers: {
          "Accept-Ranges": "bytes",
          "Content-Range": `bytes */${size}`,
        },
      });
    }

    if (range?.valid) {
      const stream = includeBody
        ? Readable.toWeb(
            createReadStream(absolutePath, {
              start: range.start,
              end: range.end,
            }),
          )
        : null;
      const contentLength = range.end - range.start + 1;

      return new Response(stream as ReadableStream<Uint8Array> | null, {
        status: 206,
        headers: {
          ...getBaseHeaders(previewFileName, contentLength),
          "Content-Range": `bytes ${range.start}-${range.end}/${size}`,
        },
      });
    }

    const stream = includeBody
      ? Readable.toWeb(createReadStream(absolutePath))
      : null;

    return new Response(stream as ReadableStream<Uint8Array> | null, {
      headers: {
        ...getBaseHeaders(previewFileName, size),
      },
    });
  } catch {
    return NextResponse.json({ error: "文件不存在。" }, { status: 404 });
  }
}

export async function GET(request: Request, context: FilePreviewRouteContext) {
  return buildPreviewResponse(request, context, true);
}

export async function HEAD(request: Request, context: FilePreviewRouteContext) {
  return buildPreviewResponse(request, context, false);
}
