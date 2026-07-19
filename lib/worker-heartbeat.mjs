import { randomUUID } from "node:crypto";
import { hostname } from "node:os";

export const BACKGROUND_WORKER_TYPE = "BACKGROUND";
export const WORKER_CAPABILITIES_SCHEMA_VERSION = "worker-capabilities:v1";
export const TRAINING_TRANSCRIPTION_CAPABILITY = "TRAINING_TRANSCRIPTION";
export const TRAINING_ANALYSIS_CAPABILITY = "TRAINING_ANALYSIS";
export const UPLOAD_MAINTENANCE_CAPABILITY = "UPLOAD_MAINTENANCE";

const DEFAULT_HEARTBEAT_INTERVAL_MS = 5_000;
const DEFAULT_HEARTBEAT_TTL_MS = 30_000;
const DEFAULT_POLL_INTERVAL_MS = 5_000;
const STALE_HEARTBEAT_RETENTION_MS = 7 * 24 * 60 * 60_000;

function boundedInteger(value, fallback, minimum, maximum, name) {
  const normalized = value === undefined ? "" : String(value).trim();
  const parsed = normalized ? Number(normalized) : fallback;
  if (
    !Number.isSafeInteger(parsed) ||
    parsed < minimum ||
    parsed > maximum
  ) {
    throw new Error(`${name} must be an integer in ${minimum}..${maximum}.`);
  }
  return parsed;
}

export function getBackgroundWorkerTiming(env = process.env) {
  const heartbeatIntervalMs = boundedInteger(
    env.BACKGROUND_WORKER_HEARTBEAT_INTERVAL_MS,
    DEFAULT_HEARTBEAT_INTERVAL_MS,
    1_000,
    60_000,
    "BACKGROUND_WORKER_HEARTBEAT_INTERVAL_MS",
  );
  const heartbeatTtlMs = boundedInteger(
    env.BACKGROUND_WORKER_HEARTBEAT_TTL_MS,
    DEFAULT_HEARTBEAT_TTL_MS,
    5_000,
    5 * 60_000,
    "BACKGROUND_WORKER_HEARTBEAT_TTL_MS",
  );
  const pollIntervalMs = boundedInteger(
    env.BACKGROUND_WORKER_POLL_INTERVAL_MS,
    DEFAULT_POLL_INTERVAL_MS,
    1_000,
    60_000,
    "BACKGROUND_WORKER_POLL_INTERVAL_MS",
  );

  if (heartbeatTtlMs < heartbeatIntervalMs * 2) {
    throw new Error(
      "BACKGROUND_WORKER_HEARTBEAT_TTL_MS must be at least twice the heartbeat interval.",
    );
  }

  return { heartbeatIntervalMs, heartbeatTtlMs, pollIntervalMs };
}

export function createBackgroundWorkerIdentity(now = new Date()) {
  const workerHostname = hostname() || "unknown-host";
  return {
    id: `${workerHostname}:${process.pid}:${randomUUID()}`,
    workerType: BACKGROUND_WORKER_TYPE,
    hostname: workerHostname,
    processId: process.pid,
    startedAt: now,
  };
}

function normalizedCapabilities(capabilities) {
  return [...new Set(capabilities)]
    .filter((value) => typeof value === "string" && value.trim())
    .map((value) => value.trim().toUpperCase())
    .sort();
}

export async function recordWorkerHeartbeat(
  client,
  { identity, capabilities, now = new Date(), ttlMs },
) {
  const capabilityList = normalizedCapabilities(capabilities);
  const expiresAt = new Date(now.getTime() + ttlMs);
  const data = {
    workerType: identity.workerType,
    hostname: identity.hostname,
    processId: identity.processId,
    capabilitiesJson: JSON.stringify(capabilityList),
    capabilitiesSchemaVersion: WORKER_CAPABILITIES_SCHEMA_VERSION,
    startedAt: identity.startedAt,
    lastSeenAt: now,
    expiresAt,
  };

  await client.workerHeartbeat.upsert({
    where: { id: identity.id },
    create: { id: identity.id, ...data },
    update: data,
  });
  return expiresAt;
}

export function expireWorkerHeartbeat(client, workerId, now = new Date()) {
  return client.workerHeartbeat.updateMany({
    where: { id: workerId },
    data: { lastSeenAt: now, expiresAt: now },
  });
}

export function cleanupStaleWorkerHeartbeats(client, now = new Date()) {
  return client.workerHeartbeat.deleteMany({
    where: {
      expiresAt: {
        lt: new Date(now.getTime() - STALE_HEARTBEAT_RETENTION_MS),
      },
    },
  });
}

function parseCapabilities(heartbeat) {
  if (
    heartbeat.capabilitiesSchemaVersion !==
    WORKER_CAPABILITIES_SCHEMA_VERSION
  ) {
    return [];
  }
  try {
    const value = JSON.parse(heartbeat.capabilitiesJson);
    return Array.isArray(value) ? normalizedCapabilities(value) : [];
  } catch {
    return [];
  }
}

export async function readBackgroundWorkerHealth(
  client,
  {
    now = new Date(),
    requiredCapabilities = /** @type {string[]} */ ([]),
  } = {},
) {
  const required = normalizedCapabilities(requiredCapabilities);
  const activeWorkers = await client.workerHeartbeat.findMany({
    where: {
      workerType: BACKGROUND_WORKER_TYPE,
      expiresAt: { gt: now },
    },
    orderBy: { lastSeenAt: "desc" },
    select: {
      id: true,
      hostname: true,
      processId: true,
      capabilitiesJson: true,
      capabilitiesSchemaVersion: true,
      startedAt: true,
      lastSeenAt: true,
      expiresAt: true,
    },
  });
  const workers = activeWorkers.map((worker) => ({
    ...worker,
    capabilities: parseCapabilities(worker),
  }));
  const capableWorkers = workers.filter((worker) =>
    required.every((capability) => worker.capabilities.includes(capability)),
  );

  return {
    healthy: capableWorkers.length > 0,
    activeCount: workers.length,
    capableCount: capableWorkers.length,
    latest: capableWorkers[0] ?? workers[0] ?? null,
    requiredCapabilities: required,
  };
}
