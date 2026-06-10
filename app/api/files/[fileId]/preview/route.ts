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

export async function GET(_request: Request, context: FilePreviewRouteContext) {
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
    const stream = Readable.toWeb(createReadStream(absolutePath));

    return new Response(stream as ReadableStream<Uint8Array>, {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Length": String(size),
        "Cache-Control": "private, max-age=0",
        "Content-Disposition": `inline; filename*=UTF-8''${encodeURIComponent(
          fileAsset.originalName,
        )}`,
      },
    });
  } catch {
    return NextResponse.json({ error: "文件不存在。" }, { status: 404 });
  }
}
