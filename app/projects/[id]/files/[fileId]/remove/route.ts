import { NextResponse } from "next/server";
import { getCurrentAccessUserId } from "@/lib/auth-server";
import { stageUploadEntries } from "@/lib/file-lifecycle.mjs";
import { prisma } from "@/lib/prisma";

export async function POST(
  _request: Request,
  context: Readonly<{ params: Promise<{ id: string; fileId: string }> }>,
) {
  const { id, fileId } = await context.params;
  const userId = await getCurrentAccessUserId();
  const file = await prisma.fileAsset.findFirst({
    where: userId
      ? { id: fileId, projectId: id, project: { ownerId: userId } }
      : { id: fileId, projectId: id },
    select: {
      id: true,
      filePath: true,
      previewPdfPath: true,
      _count: { select: { slideEvents: true } },
    },
  });

  if (!file) {
    return new NextResponse("文件不存在或不属于当前项目。", { status: 404 });
  }

  const snapshotReferenceCount = await prisma.trainingSession.count({
    where: { projectId: id, primaryFileId: file.id },
  });
  if (file._count.slideEvents > 0 || snapshotReferenceCount > 0) {
    return NextResponse.json(
      { error: "该材料已被训练记录引用，不能删除；可改为排除 AI。" },
      { status: 409 },
    );
  }

  const storedPaths = [file.filePath, file.previewPdfPath].filter(
    (value): value is string => Boolean(value),
  );
  const otherReferenceCount = await prisma.fileAsset.count({
    where: {
      id: { not: file.id },
      OR: [
        { filePath: { in: storedPaths } },
        { previewPdfPath: { in: storedPaths } },
      ],
    },
  });
  if (otherReferenceCount > 0) {
    return NextResponse.json(
      { error: "该文件路径仍被其他材料记录引用，不能删除。" },
      { status: 409 },
    );
  }

  let staged: Awaited<ReturnType<typeof stageUploadEntries>>;
  try {
    staged = await stageUploadEntries({
      workspaceRoot: process.cwd(),
      paths: storedPaths,
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "材料删除失败。" },
      { status: 500 },
    );
  }
  if (staged.contendedCount > 0) {
    await staged.rollback();
    return NextResponse.json(
      { error: "该材料正在被其他删除请求处理，请稍后重试。" },
      { status: 409 },
    );
  }

  try {
    await prisma.fileAsset.deleteMany({ where: { id: file.id } });
  } catch (error) {
    await staged.rollback();
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "材料删除失败。" },
      { status: 500 },
    );
  }

  await staged.commit();
  return NextResponse.json({ deleted: true });
}
