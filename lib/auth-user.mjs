export async function findActiveAuthUser(prisma, session) {
  if (!session) {
    return null;
  }

  const user = await prisma.user.findUnique({
    where: { id: session.userId },
    select: {
      id: true,
      name: true,
      email: true,
      role: true,
      sessionVersion: true,
      disabledAt: true,
    },
  });

  if (
    !user ||
    user.disabledAt ||
    user.sessionVersion !== session.sessionVersion
  ) {
    return null;
  }

  return {
    id: user.id,
    name: user.name,
    email: user.email,
    role: user.role,
    sessionVersion: user.sessionVersion,
  };
}
