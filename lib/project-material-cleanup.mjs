export async function claimExpiredProjectMaterial(
  client,
  { id, now, staleReservationBefore },
) {
  const claimed = await client.pendingProjectMaterial.deleteMany({
    where: {
      id,
      expiresAt: { lte: now },
      OR: [
        { consumedAt: null },
        { consumedAt: { lte: staleReservationBefore } },
      ],
    },
  });

  return claimed.count === 1;
}
