import { NextRequest, NextResponse } from "next/server";
import { getCurrentAuthUserId } from "@/lib/auth-server";
import { prisma } from "@/lib/prisma";

type ToggleContextRouteContext = Readonly<{
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

export async function POST(
  request: NextRequest,
  context: ToggleContextRouteContext,
) {
  const { id, fileId } = await context.params;
  const userId = await getCurrentAuthUserId();
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
      parseStatus: true,
      includeInAIContext: true,
    },
  });

  if (!fileAsset) {
    return new NextResponse("文件不存在或不属于当前项目。", { status: 404 });
  }

  if (fileAsset.parseStatus !== "SUCCESS") {
    return redirectToProject(
      request,
      id,
      new URLSearchParams({
        contextError: "只有解析成功的文件可以切换 AI 分析状态。",
      }),
    );
  }

  const updatedFile = await prisma.fileAsset.update({
    where: {
      id: fileAsset.id,
    },
    data: {
      includeInAIContext: !fileAsset.includeInAIContext,
    },
    select: {
      includeInAIContext: true,
    },
  });

  return redirectToProject(
    request,
    id,
    new URLSearchParams({
      contextStatus: updatedFile.includeInAIContext ? "included" : "excluded",
    }),
  );
}
