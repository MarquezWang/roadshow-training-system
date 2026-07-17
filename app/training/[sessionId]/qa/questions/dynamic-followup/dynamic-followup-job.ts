import { acquireAsyncJob, releaseAsyncJob } from "@/lib/async-job";

const DYNAMIC_FOLLOWUP_JOB_LEASE_MS = 10 * 60_000;

export const dynamicFollowupJobKey = (sessionId: string) =>
  `dynamic-followup:${sessionId}`;

export function acquireDynamicFollowupJob(sessionId: string) {
  return acquireAsyncJob({
    jobKey: dynamicFollowupJobKey(sessionId),
    jobType: "DYNAMIC_FOLLOWUP",
    resourceId: sessionId,
    leaseMs: DYNAMIC_FOLLOWUP_JOB_LEASE_MS,
  });
}

export function releaseDynamicFollowupJob(params: {
  sessionId: string;
  ownerToken: string | null;
  failed: boolean;
}) {
  return releaseAsyncJob({
    jobKey: dynamicFollowupJobKey(params.sessionId),
    ownerToken: params.ownerToken,
    status: params.failed ? "FAILED" : "COMPLETED",
  });
}
