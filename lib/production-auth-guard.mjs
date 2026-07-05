export function assertProductionAuthEnabled(env = process.env) {
  if (env.NODE_ENV === "production" && env.AUTH_ENABLED !== "true") {
    throw new Error(
      "Refusing to start production server: AUTH_ENABLED must be true in production.",
    );
  }
}
