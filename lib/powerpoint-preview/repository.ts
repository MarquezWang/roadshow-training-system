import { prisma } from "@/lib/prisma";
import { CONVERSION_TIMEOUT_MS } from "./constants";
import type { PreviewStatus } from "./types";

const previewStateSelect = {
  previewStatus: true,
  previewPdfPath: true,
  previewError: true,
};

export async function acquirePreviewAttempt({
  fileId,
  attemptId,
  startedAt,
}: {
  fileId: string;
  attemptId: string;
  startedAt: Date;
}) {
  const staleBefore = new Date(
    startedAt.getTime() - Math.max(CONVERSION_TIMEOUT_MS * 2, 120_000),
  );
  const acquisition = await prisma.fileAsset.updateMany({
    where: {
      id: fileId,
      OR: [
        { previewStatus: { notIn: ["PENDING", "FINALIZING"] } },
        { previewStartedAt: null },
        { previewStartedAt: { lt: staleBefore } },
      ],
    },
    data: {
      previewStatus: "PENDING",
      previewError: null,
      previewAttemptId: attemptId,
      previewStartedAt: startedAt,
    },
  });
  return acquisition.count === 1;
}

export async function readPreviewState(
  fileId: string,
  fallbackError: string,
) {
  const current = await prisma.fileAsset.findUnique({
    where: { id: fileId },
    select: previewStateSelect,
  });
  return {
    previewStatus: (current?.previewStatus ?? "FAILED") as PreviewStatus,
    previewPdfPath: current?.previewPdfPath ?? null,
    previewError: current?.previewError ?? fallbackError,
  };
}

export async function markPreviewFinalizing(
  fileId: string,
  attemptId: string,
) {
  const finalizing = await prisma.fileAsset.updateMany({
    where: {
      id: fileId,
      previewAttemptId: attemptId,
      previewStatus: "PENDING",
    },
    data: { previewStatus: "FINALIZING" },
  });
  return finalizing.count === 1;
}

export async function markPreviewReady(
  fileId: string,
  attemptId: string,
  previewPdfPath: string,
) {
  await prisma.fileAsset.updateMany({
    where: {
      id: fileId,
      previewAttemptId: attemptId,
      previewStatus: "FINALIZING",
    },
    data: {
      previewPdfPath,
      previewStatus: "READY",
      previewError: null,
      previewAttemptId: null,
      previewStartedAt: null,
    },
  });
}

export async function markPreviewFailed(
  fileId: string,
  attemptId: string,
  previewError: string,
) {
  await prisma.fileAsset.updateMany({
    where: {
      id: fileId,
      previewAttemptId: attemptId,
      previewStatus: { in: ["PENDING", "FINALIZING"] },
    },
    data: {
      previewPdfPath: null,
      previewStatus: "FAILED",
      previewError,
      previewAttemptId: null,
      previewStartedAt: null,
    },
  });
}
