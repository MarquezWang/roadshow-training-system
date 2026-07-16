import { NextRequest, NextResponse } from "next/server";
import { getCurrentAccessUserId, withOwnerFilter } from "@/lib/auth-server";
import { removeProjectUpload, saveProjectUpload } from "@/lib/file-upload";
import { parseFileToText } from "@/lib/file-parser";
import { prisma } from "@/lib/prisma";
import { readUploadIdempotencyKey } from "@/lib/upload-idempotency";
import {
  generatePowerPointPreviewPdf,
  isPowerPointFile,
} from "@/lib/powerpoint-preview";

type UploadRouteContext = Readonly<{
  params: Promise<{
    id: string;
  }>;
}>;

function redirectToProject(
  request: NextRequest,
  projectId: string,
  params: URLSearchParams,
) {
  const url = new URL(`/projects/${projectId}`, request.url);
  params.forEach((value, key) => {
    url.searchParams.set(key, value);
  });
  url.hash = "project-materials";

  return NextResponse.redirect(url, 303);
}

function uploadSuccessParams(file: {
  parseStatus: string;
  parseError: string | null;
}, replay = false) {
  return new URLSearchParams({
    uploadStatus: "success",
    ...(file.parseStatus === "SUCCESS" ? { parseStatus: "success" } : {}),
    ...(file.parseError ? { parseError: file.parseError } : {}),
    ...(replay ? { idempotentReplay: "true" } : {}),
  });
}

export async function POST(request: NextRequest, context: UploadRouteContext) {
  const { id } = await context.params;
  const userId = await getCurrentAccessUserId();
  const project = await prisma.project.findFirst({
    where: withOwnerFilter({ id }, userId),
    select: {
      id: true,
    },
  });

  if (!project) {
    return new NextResponse("项目不存在。", { status: 404 });
  }

  try {
    const formData = await request.formData();
    const uploadKey = readUploadIdempotencyKey(request, formData);
    const file = formData.get("file");

    if (!(file instanceof File)) {
      return redirectToProject(
        request,
        id,
        new URLSearchParams({ uploadError: "请选择需要上传的文件。" }),
      );
    }

    const replay = await prisma.fileAsset.findUnique({
      where: {
        projectId_uploadKey: {
          projectId: id,
          uploadKey,
        },
      },
      select: {
        parseStatus: true,
        parseError: true,
      },
    });
    if (replay) {
      return redirectToProject(request, id, uploadSuccessParams(replay, true));
    }

    const savedFile = await saveProjectUpload(id, file);

    let fileAsset;
    try {
      fileAsset = await prisma.fileAsset.create({
        data: {
          projectId: id,
          originalName: savedFile.originalName,
          fileType: savedFile.fileType,
          filePath: savedFile.filePath,
          fileSize: savedFile.fileSize,
          parseStatus: "PENDING",
          extractedText: null,
          parseError: null,
          uploadKey,
        },
      });
    } catch (error) {
      await removeProjectUpload(savedFile.filePath).catch(() => undefined);
      const concurrentReplay = await prisma.fileAsset.findUnique({
        where: {
          projectId_uploadKey: {
            projectId: id,
            uploadKey,
          },
        },
        select: {
          parseStatus: true,
          parseError: true,
        },
      });
      if (concurrentReplay) {
        return redirectToProject(
          request,
          id,
          uploadSuccessParams(concurrentReplay, true),
        );
      }
      throw error;
    }

    try {
      const extractedText = await parseFileToText(
        savedFile.filePath,
        savedFile.fileType,
      );
      fileAsset = await prisma.fileAsset.update({
        where: { id: fileAsset.id },
        data: {
          extractedText,
          parseStatus: "SUCCESS",
          parseError: null,
        },
      });
    } catch (error) {
      const parseError =
        error instanceof Error ? error.message : "文件解析失败。";
      fileAsset = await prisma.fileAsset.update({
        where: { id: fileAsset.id },
        data: {
          parseStatus: "FAILED",
          parseError,
        },
      });
    }

    if (isPowerPointFile(savedFile)) {
      await generatePowerPointPreviewPdf({
        id: fileAsset.id,
        projectId: id,
        originalName: savedFile.originalName,
        fileType: savedFile.fileType,
        filePath: savedFile.filePath,
      });
    }

    return redirectToProject(request, id, uploadSuccessParams(fileAsset));
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "文件保存失败，请稍后重试。";

    return redirectToProject(
      request,
      id,
      new URLSearchParams({ uploadError: message }),
    );
  }
}
