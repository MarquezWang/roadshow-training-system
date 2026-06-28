import { NextRequest, NextResponse } from "next/server";
import { getCurrentAccessUserId } from "@/lib/auth-server";
import { parseFileToText } from "@/lib/file-parser";
import { prisma } from "@/lib/prisma";

type ParseRouteContext = Readonly<{
  params: Promise<{
    id: string;
    fileId: string;
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

export async function POST(request: NextRequest, context: ParseRouteContext) {
  const { id, fileId } = await context.params;
  const userId = await getCurrentAccessUserId();
  const fileAsset = await prisma.fileAsset.findFirst({
    where: userId
      ? {
          id: fileId,
          projectId: id,
          project: {
            ownerId: userId,
          },
        }
      : {
          id: fileId,
          projectId: id,
        },
    select: {
      id: true,
      filePath: true,
      fileType: true,
    },
  });

  if (!fileAsset) {
    return new NextResponse("文件不存在或不属于当前项目。", { status: 404 });
  }

  try {
    const extractedText = await parseFileToText(
      fileAsset.filePath,
      fileAsset.fileType,
    );

    await prisma.fileAsset.update({
      where: {
        id: fileAsset.id,
      },
      data: {
        extractedText,
        parseStatus: "SUCCESS",
        parseError: null,
      },
    });

    return redirectToProject(
      request,
      id,
      new URLSearchParams({ parseStatus: "success" }),
    );
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "文件解析失败，请稍后重试。";

    await prisma.fileAsset.update({
      where: {
        id: fileAsset.id,
      },
      data: {
        parseStatus: "FAILED",
        parseError: message,
      },
    });

    return redirectToProject(
      request,
      id,
      new URLSearchParams({ parseError: message }),
    );
  }
}
