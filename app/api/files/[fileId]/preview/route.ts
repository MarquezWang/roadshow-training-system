import { stat } from "fs/promises";
import { createReadStream } from "fs";
import path from "path";
import { Readable } from "stream";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

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

  if (!normalizedPath.startsWith("uploads/projects/")) {
    throw new Error("INVALID_UPLOAD_PATH");
  }

  const uploadsRoot = path.resolve(process.cwd(), "uploads");
  const absolutePath = path.resolve(process.cwd(), normalizedPath);
  const relativeToUploads = path.relative(uploadsRoot, absolutePath);

  if (
    relativeToUploads.startsWith("..") ||
    path.isAbsolute(relativeToUploads)
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

function getBaseHeaders(fileName: string, contentLength: number) {
  return {
    "Accept-Ranges": "bytes",
    "Cache-Control": "private, max-age=3600",
    "Content-Disposition": buildContentDisposition(fileName),
    "Content-Length": String(contentLength),
    "Content-Type": "application/pdf",
  };
}

function parseRangeHeader(rangeHeader: string | null, size: number): ResolvedRange | null {
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
    },
  });

  if (!fileAsset) {
    return NextResponse.json({ error: "文件不存在。" }, { status: 404 });
  }

  if (fileAsset.fileType.toLowerCase().replace(/^\./, "") !== "pdf") {
    return NextResponse.json(
      { error: "当前预览接口仅支持 PDF 文件。" },
      { status: 415 },
    );
  }

  try {
    const { absolutePath, size } = await resolveUploadFilePath(
      fileAsset.filePath,
    );
    const range = parseRangeHeader(request.headers.get("range"), size);

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
          ...getBaseHeaders(fileAsset.originalName, contentLength),
          "Content-Range": `bytes ${range.start}-${range.end}/${size}`,
        },
      });
    }

    const stream = includeBody
      ? Readable.toWeb(createReadStream(absolutePath))
      : null;

    return new Response(stream as ReadableStream<Uint8Array> | null, {
      headers: {
        ...getBaseHeaders(fileAsset.originalName, size),
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
