export const backgroundTaskModes = Object.freeze({
  embedded: "embedded",
  external: "external",
});

/**
 * @param {Readonly<Record<string, string | undefined>>} [env]
 */
export function getBackgroundTaskMode(env = process.env) {
  const value = env.BACKGROUND_TASK_MODE?.trim().toLowerCase() || "embedded";
  if (value === backgroundTaskModes.embedded) {
    return backgroundTaskModes.embedded;
  }
  if (value === backgroundTaskModes.external) {
    return backgroundTaskModes.external;
  }
  throw new Error(
    "BACKGROUND_TASK_MODE must be either embedded or external.",
  );
}

/**
 * @param {Readonly<Record<string, string | undefined>>} [env]
 */
export function usesExternalBackgroundWorker(env = process.env) {
  return getBackgroundTaskMode(env) === backgroundTaskModes.external;
}

/**
 * @param {Readonly<Record<string, string | undefined>>} [env]
 */
export function assertProductionBackgroundTaskMode(env = process.env) {
  const mode = getBackgroundTaskMode(env);
  if (
    env.NODE_ENV === "production" &&
    mode !== backgroundTaskModes.external
  ) {
    throw new Error(
      "Production requires BACKGROUND_TASK_MODE=external and a standalone worker.",
    );
  }
  return mode;
}

/**
 * @param {Readonly<Record<string, string | undefined>>} [env]
 */
export function runsBackgroundTasksInWebProcess(env = process.env) {
  return getBackgroundTaskMode(env) === backgroundTaskModes.embedded;
}
