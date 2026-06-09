import { NextRequest, NextResponse } from "next/server";
import { saveProjectUpload } from "@/lib/file-upload";
import { prisma } from "@/lib/prisma";

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

  return NextResponse.redirect(url, 303);
}

export async function POST(request: NextRequest, context: UploadRouteContext) {
  const { id } = await context.params;
  const project = await prisma.project.findUnique({
    where: {
      id,
    },
    select: {
      id: true,
    },
  });

  if (!project) {
    return new NextResponse("项目不存在。", { status: 404 });
  }

  try {
    const formData = await request.formData();
    const file = formData.get("file");

    if (!(file instanceof File)) {
      return redirectToProject(
        request,
        id,
        new URLSearchParams({ uploadError: "请选择需要上传的文件。" }),
      );
    }

    const savedFile = await saveProjectUpload(id, file);

    await prisma.fileAsset.create({
      data: {
        projectId: id,
        originalName: savedFile.originalName,
        fileType: savedFile.fileType,
        filePath: savedFile.filePath,
        fileSize: savedFile.fileSize,
        parseStatus: "PENDING",
        extractedText: null,
        parseError: null,
      },
    });

    return redirectToProject(
      request,
      id,
      new URLSearchParams({ uploadStatus: "success" }),
    );
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
