import { NextResponse } from "next/server";

import { getCurrentAuthUser } from "@/lib/auth-server";
import { prisma } from "@/lib/prisma";
import {
  UPLOAD_MAINTENANCE_JOB_KEY,
  UPLOAD_MAINTENANCE_JOB_TYPE,
} from "@/lib/upload-maintenance-job.mjs";
import {
  getConfiguredUploadMaintenanceOptions,
  isUploadMaintenanceEnabled,
  runConfiguredUploadMaintenancePass,
} from "@/lib/upload-maintenance-task";
import { scanUploadTree } from "@/lib/upload-orphan-scan.mjs";

export const runtime = "nodejs";

async function requireAdminApiUser() {
  const user = await getCurrentAuthUser();
  return Boolean(user && user.role === "ADMIN");
}

async function getMaintenanceOverview(includeScan: boolean) {
  const now = new Date();
  const [latestJob, statusGroups, staleRunningCount] = await Promise.all([
    prisma.asyncJob.findUnique({
      where: { jobKey: UPLOAD_MAINTENANCE_JOB_KEY },
      select: {
        status: true,
        attempt: true,
        updatedAt: true,
        leaseExpiresAt: true,
        errorMessage: true,
      },
    }),
    prisma.asyncJob.groupBy({
      by: ["status"],
      _count: { _all: true },
    }),
    prisma.asyncJob.count({
      where: {
        status: "RUNNING",
        leaseExpiresAt: { lt: now },
      },
    }),
  ]);
  const jobCounts = Object.fromEntries(
    statusGroups.map((group) => [group.status, group._count._all]),
  );

  let scan = null;
  if (includeScan) {
    const [files, recordings] = await Promise.all([
      prisma.fileAsset.findMany({
        select: { filePath: true, previewPdfPath: true },
      }),
      prisma.trainingRecording.findMany({ select: { filePath: true } }),
    ]);
    const references = [
      ...files.flatMap((file) => [file.filePath, file.previewPdfPath]),
      ...recordings.map((recording) => recording.filePath),
    ];
    const report = await scanUploadTree({
      workspaceRoot: /* turbopackIgnore: true */ process.cwd(),
      references,
      deleteStale: false,
      ...getConfiguredUploadMaintenanceOptions(),
    });
    scan = {
      referencedFileCount: report.referencedFileCount,
      missingReferenceCount: report.missingReferences.length,
      unsafeReferenceCount: report.unsafeReferences.length,
      orphanFileCount: report.orphanFiles.length,
      recentUnreferencedFileCount: report.recentUnreferencedFiles.length,
      staleTemporaryFileCount: report.staleTemporaryFiles.length,
      staleAttemptDirectoryCount: report.staleAttemptDirectories.length,
      staleTrashEntryCount: report.staleTrashEntries.length,
      retentionHours: report.retentionHours,
    };
  }

  return {
    automaticMaintenanceEnabled: isUploadMaintenanceEnabled(),
    maintenanceJobType: UPLOAD_MAINTENANCE_JOB_TYPE,
    latestJob: latestJob
      ? {
          ...latestJob,
          updatedAt: latestJob.updatedAt.toISOString(),
          leaseExpiresAt: latestJob.leaseExpiresAt?.toISOString() ?? null,
          errorMessage: latestJob.errorMessage?.slice(0, 300) ?? null,
        }
      : null,
    jobCounts,
    staleRunningCount,
    scan,
  };
}

export async function GET(request: Request) {
  if (!(await requireAdminApiUser())) {
    return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
  }

  const includeScan = new URL(request.url).searchParams.get("scan") === "1";
  return NextResponse.json(await getMaintenanceOverview(includeScan));
}

export async function POST() {
  if (!(await requireAdminApiUser())) {
    return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
  }

  const result = await runConfiguredUploadMaintenancePass();
  if (result.state === "failed") {
    return NextResponse.json(
      { error: "上传目录维护执行失败。" },
      { status: 500 },
    );
  }

  return NextResponse.json({
    executionState: result.state,
    deletedCount:
      result.state === "completed" ? (result.report?.deleted.length ?? 0) : 0,
    reconciled:
      result.state === "completed" ? (result.reconciled ?? null) : null,
    overview: await getMaintenanceOverview(true),
  });
}
