import assert from "node:assert/strict";
import test from "node:test";

import { claimExpiredProjectMaterial } from "../../lib/project-material-cleanup.mjs";
import {
  deferTrainingAnalysisJob,
  renewTrainingAnalysisJobLease,
  startTrainingAnalysisLeaseRenewal,
  trainingAnalysisJobKey,
} from "../../lib/training-analysis-job.mjs";

function pendingMaterialClient(row) {
  return {
    pendingProjectMaterial: {
      async deleteMany({ where }) {
        const consumedAt = row?.consumedAt ?? null;
        const eligible = Boolean(
          row &&
            row.id === where.id &&
            row.expiresAt <= where.expiresAt.lte &&
            (consumedAt === null ||
              consumedAt <= where.OR[1].consumedAt.lte),
        );
        if (!eligible) return { count: 0 };
        row = null;
        return { count: 1 };
      },
    },
    get row() {
      return row;
    },
  };
}

test("reserved material cannot be claimed by stale cleanup results", async () => {
  const now = new Date("2026-07-19T12:00:00.000Z");
  const client = pendingMaterialClient({
    id: "material-1",
    expiresAt: new Date(now.getTime() - 1_000),
    consumedAt: new Date(now.getTime() - 1_000),
  });

  const claimed = await claimExpiredProjectMaterial(client, {
    id: "material-1",
    now,
    staleReservationBefore: new Date(now.getTime() - 30 * 60_000),
  });

  assert.equal(claimed, false);
  assert.ok(client.row, "reservation winner must keep the database record");
});

test("cleanup atomically claims an unreserved expired material", async () => {
  const now = new Date("2026-07-19T12:00:00.000Z");
  const client = pendingMaterialClient({
    id: "material-2",
    expiresAt: new Date(now.getTime() - 1_000),
    consumedAt: null,
  });

  assert.equal(
    await claimExpiredProjectMaterial(client, {
      id: "material-2",
      now,
      staleReservationBefore: new Date(now.getTime() - 30 * 60_000),
    }),
    true,
  );
  assert.equal(client.row, null);
});

test("analysis lease renews only for the current live owner", async () => {
  const now = new Date("2026-07-19T12:00:00.000Z");
  const job = {
    jobKey: trainingAnalysisJobKey("session-1"),
    jobType: "TRAINING_ANALYSIS",
    resourceId: "session-1",
    status: "RUNNING",
    ownerToken: "owner-1",
    leaseExpiresAt: new Date(now.getTime() + 1_000),
  };
  const client = {
    asyncJob: {
      async updateMany({ where, data }) {
        const matches =
          job.jobKey === where.jobKey &&
          job.jobType === where.jobType &&
          job.resourceId === where.resourceId &&
          job.status === where.status &&
          job.ownerToken === where.ownerToken &&
          job.leaseExpiresAt > where.leaseExpiresAt.gt;
        if (!matches) return { count: 0 };
        job.leaseExpiresAt = data.leaseExpiresAt;
        return { count: 1 };
      },
    },
  };

  assert.equal(
    await renewTrainingAnalysisJobLease(client, {
      sessionId: "session-1",
      ownerToken: "owner-1",
      now,
      leaseMs: 10_000,
    }),
    true,
  );
  assert.equal(job.leaseExpiresAt.getTime(), now.getTime() + 10_000);
  assert.equal(
    await renewTrainingAnalysisJobLease(client, {
      sessionId: "session-1",
      ownerToken: "stale-owner",
      now,
      leaseMs: 10_000,
    }),
    false,
  );
});

test("analysis lease heartbeat stops scheduling after teardown", async () => {
  let renewalCount = 0;
  const client = {
    asyncJob: {
      async updateMany() {
        renewalCount += 1;
        return { count: 1 };
      },
    },
  };
  const renewal = startTrainingAnalysisLeaseRenewal(client, {
    sessionId: "session-2",
    ownerToken: "owner-2",
    intervalMs: 5,
    leaseMs: 100,
  });

  await new Promise((resolve) => setTimeout(resolve, 30));
  await renewal.stop();
  const countAfterStop = renewalCount;
  await new Promise((resolve) => setTimeout(resolve, 20));

  assert.ok(countAfterStop > 0);
  assert.equal(renewalCount, countAfterStop);
});

test("AI resource deferral preserves the report attempt and exact delay", async () => {
  const now = new Date("2026-07-19T12:00:00.000Z");
  let job = {
    id: "job-1",
    jobKey: trainingAnalysisJobKey("session-3"),
    jobType: "TRAINING_ANALYSIS",
    resourceId: "session-3",
    status: "RUNNING",
    ownerToken: "owner-3",
    leaseExpiresAt: new Date(now.getTime() + 60_000),
    attempt: 1,
    maxAttempts: 3,
  };
  const client = {
    asyncJob: {
      async findUnique() {
        return job;
      },
      async updateMany({ where, data }) {
        const matches =
          job.id === where.id &&
          job.status === where.status &&
          job.ownerToken === where.ownerToken &&
          job.attempt === where.attempt &&
          job.leaseExpiresAt > where.leaseExpiresAt.gt;
        if (!matches) return { count: 0 };
        job = {
          ...job,
          ...data,
          attempt:
            typeof data.attempt === "number"
              ? data.attempt
              : job.attempt,
        };
        return { count: 1 };
      },
    },
  };

  const deferred = await deferTrainingAnalysisJob(client, {
    sessionId: "session-3",
    ownerToken: "owner-3",
    errorMessage: "daily budget exhausted",
    retryDelayMs: 12 * 60 * 60_000,
    now,
  });

  assert.equal(deferred.state, "deferred");
  assert.equal(deferred.job.status, "RETRY_WAIT");
  assert.equal(deferred.job.attempt, 0);
  assert.equal(
    deferred.job.nextAttemptAt.getTime(),
    now.getTime() + 12 * 60 * 60_000,
  );
});
