import { DEFAULT_TRANSCRIPTION_LEASE_MS } from "./constants.mjs";

export async function renewTrainingTranscriptionLease(prisma, params) {
  const now = params.now ?? new Date();
  const result = await prisma.asyncJob.updateMany({
    where: {
      jobKey: params.jobKey,
      ownerToken: params.ownerToken,
      status: "RUNNING",
    },
    data: {
      leaseExpiresAt: new Date(
        now.getTime() +
          (params.leaseMs ?? DEFAULT_TRANSCRIPTION_LEASE_MS),
      ),
    },
  });
  return result.count === 1;
}
