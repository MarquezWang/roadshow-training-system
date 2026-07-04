type AuthGuardEnv = Readonly<{
  AUTH_ENABLED?: string;
  NODE_ENV?: string;
}>;

export function assertProductionAuthEnabled(env: AuthGuardEnv = process.env) {
  if (env.NODE_ENV === "production" && env.AUTH_ENABLED !== "true") {
    throw new Error(
      "Refusing to start production server: AUTH_ENABLED must be true in production.",
    );
  }
}
