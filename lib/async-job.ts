import { randomUUID } from "node:crypto";
import { prisma } from "@/lib/prisma";

export async function acquireAsyncJob(params: {
  jobKey: string;
  jobType: string;
  resourceId: string;
  leaseMs: number;
}) {
  const now = new Date();
  const ownerToken = randomUUID();
  const leaseExpiresAt = new Date(now.getTime() + params.leaseMs);

  return prisma.$transaction(async (transaction) => {
    const existing = await transaction.asyncJob.findUnique({
      where: { jobKey: params.jobKey },
    });

    if (
      existing?.status === "RUNNING" &&
      existing.leaseExpiresAt &&
      existing.leaseExpiresAt > now
    ) {
      return null;
    }

    const job = existing
      ? await transaction.asyncJob.update({
          where: { id: existing.id },
          data: {
            status: "RUNNING",
            ownerToken,
            leaseExpiresAt,
            nextAttemptAt: null,
            attempt: { increment: 1 },
            errorMessage: null,
          },
        })
      : await transaction.asyncJob.create({
          data: {
            jobKey: params.jobKey,
            jobType: params.jobType,
            resourceId: params.resourceId,
            status: "RUNNING",
            ownerToken,
            leaseExpiresAt,
          },
        });

    return { ownerToken, job };
  });
}

export function getAsyncJob(jobKey: string) {
  return prisma.asyncJob.findUnique({ where: { jobKey } });
}

export async function releaseAsyncJob(params: {
  jobKey: string;
  ownerToken: string | null;
  status: "COMPLETED" | "FAILED";
  errorMessage?: string | null;
}) {
  if (!params.ownerToken) {
    return false;
  }

  const result = await prisma.asyncJob.updateMany({
    where: {
      jobKey: params.jobKey,
      ownerToken: params.ownerToken,
      status: "RUNNING",
    },
    data: {
      status: params.status,
      leaseExpiresAt: null,
      nextAttemptAt: null,
      errorMessage: params.errorMessage?.slice(0, 500) ?? null,
    },
  });

  return result.count === 1;
}
