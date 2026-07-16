import { createReadStream } from "fs";
import { open, stat } from "fs/promises";
import path from "path";
import { Readable } from "stream";
import { NextResponse } from "next/server";
import { getCurrentAccessUserId } from "@/lib/auth-server";
import { prisma } from "@/lib/prisma";
import {
  generatePowerPointPreviewPdf,
  getPreviewPdfRelativePath,
  isPdfFile,
  isPowerPointFile,
} from "@/lib/powerpoint-preview";

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

  const fileStat = await stat(/* turbopackIgnore: true */ absolutePath);

  if (!fileStat.isFile()) {
    throw new Error("FILE_NOT_FOUND");
  }

  return {
    absolutePath,
    size: fileStat.size,
  };
}

async function isValidPdfFile(absolutePath: string, size: number) {
  if (size < 100) {
    return false;
  }

  const file = await open(/* turbopackIgnore: true */ absolutePath, "r");

  try {
    const header = Buffer.alloc(5);
    await file.read(header, 0, header.length, 0);

    return header.toString("ascii") === "%PDF-";
  } finally {
    await file.close();
  }
}

async function regeneratePowerPointPreview(fileAsset: {
  id: string;
  projectId: string;
  originalName: string;
  fileType: string;
  filePath: string;
}) {
  const result = await generatePowerPointPreviewPdf(fileAsset);

  return result.previewStatus === "READY" ? result.previewPdfPath : null;
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
  allowRegenerate = true,
) {
  const { fileId } = await context.params;
  const userId = await getCurrentAccessUserId();
  const fileAsset = await prisma.fileAsset.findFirst({
    where: userId
      ? {
          id: fileId,
          project: {
            ownerId: userId,
          },
        }
      : {
          id: fileId,
        },
    select: {
      id: true,
      projectId: true,
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
  const expectedPreviewPdfPath = isConvertedPowerPoint
    ? getPreviewPdfRelativePath(fileAsset.projectId, fileAsset.id)
    : null;

  if (!isOriginalPdf && !isConvertedPowerPoint) {
    const isPowerPoint = isPowerPointFile(fileAsset);
    const error =
      isPowerPoint &&
        (fileAsset.previewStatus === "PENDING" ||
          fileAsset.previewStatus === "FINALIZING")
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

  let previewPath = isOriginalPdf
    ? fileAsset.filePath
    : fileAsset.previewPdfPath;

  if (
    isConvertedPowerPoint &&
    expectedPreviewPdfPath &&
    previewPath !== expectedPreviewPdfPath
  ) {
    previewPath = allowRegenerate
      ? await regeneratePowerPointPreview(fileAsset)
      : null;

    if (previewPath === expectedPreviewPdfPath) {
      return buildPreviewResponse(request, context, includeBody, false);
    }

    return NextResponse.json(
      {
        error:
          "PPT 展示预览生成失败，但该材料仍可用于 AI 分析。建议重新上传或重新生成预览。",
      },
      { status: 409 },
    );
  }

  if (!previewPath) {
    return NextResponse.json(
      { error: "当前文件没有可展示的 PDF 预览。" },
      { status: 404 },
    );
  }

  try {
    const { absolutePath, size } = await resolveUploadFilePath(previewPath);
    const isValidPdf = await isValidPdfFile(absolutePath, size);

    if (!isValidPdf) {
      if (isConvertedPowerPoint && allowRegenerate) {
        previewPath = await regeneratePowerPointPreview(fileAsset);

        if (previewPath) {
          return buildPreviewResponse(request, context, includeBody, false);
        }
      }

      return NextResponse.json(
        { error: "当前文件的 PDF 预览无效。" },
        { status: 415 },
      );
    }

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
            createReadStream(/* turbopackIgnore: true */ absolutePath, {
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
      ? Readable.toWeb(
          createReadStream(/* turbopackIgnore: true */ absolutePath),
        )
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

export async function POST(
  _request: Request,
  context: FilePreviewRouteContext,
) {
  const { fileId } = await context.params;
  const userId = await getCurrentAccessUserId();
  const fileAsset = await prisma.fileAsset.findFirst({
    where: userId
      ? { id: fileId, project: { ownerId: userId } }
      : { id: fileId },
    select: {
      id: true,
      projectId: true,
      originalName: true,
      fileType: true,
      filePath: true,
    },
  });
  if (!fileAsset) {
    return NextResponse.json({ error: "文件不存在。" }, { status: 404 });
  }
  if (!isPowerPointFile(fileAsset)) {
    return NextResponse.json({ error: "只有 PPTX 支持生成预览。" }, { status: 415 });
  }

  const result = await generatePowerPointPreviewPdf(fileAsset);
  return NextResponse.json(result, {
    status: result.previewStatus === "READY" ? 200 : 409,
  });
}
