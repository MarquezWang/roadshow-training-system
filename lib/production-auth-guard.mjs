export function assertProductionAuthEnabled(env = process.env) {
  if (env.NODE_ENV !== "production") {
    return;
  }

  if (env.AUTH_ENABLED !== "true") {
    throw new Error(
      "Refusing to start production server: AUTH_ENABLED must be true in production.",
    );
  }

  const authSecret = env.AUTH_SECRET?.trim() ?? "";
  const previousAuthSecret = env.AUTH_SECRET_PREVIOUS?.trim() ?? "";
  const knownDevelopmentSecrets = new Set([
    "roadshow-dev-auth-secret",
    "local-dev-auth-secret-please-change",
  ]);

  if (authSecret.length < 32 || knownDevelopmentSecrets.has(authSecret)) {
    throw new Error(
      "Refusing to start production server: AUTH_SECRET must be an independent random secret with at least 32 characters.",
    );
  }

  if (
    previousAuthSecret &&
    (previousAuthSecret.length < 32 ||
      knownDevelopmentSecrets.has(previousAuthSecret))
  ) {
    throw new Error(
      "Refusing to start production server: AUTH_SECRET_PREVIOUS must be an independent random secret with at least 32 characters.",
    );
  }

  if (previousAuthSecret && previousAuthSecret === authSecret) {
    throw new Error(
      "Refusing to start production server: AUTH_SECRET_PREVIOUS must differ from AUTH_SECRET.",
    );
  }
}
