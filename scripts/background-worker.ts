import { loadEnvConfig } from "@next/env";

const controller = new AbortController();
let stopping = false;

function requestStop(signal: string) {
  if (stopping) return;
  stopping = true;
  console.log(`[background-worker] received ${signal}, stopping`);
  controller.abort();
}

process.once("SIGINT", () => requestStop("SIGINT"));
process.once("SIGTERM", () => requestStop("SIGTERM"));

async function main() {
  let disconnectPrisma: (() => Promise<void>) | null = null;
  try {
    loadEnvConfig(process.cwd(), process.env.NODE_ENV !== "production");
    const [{ runBackgroundWorker }, { prisma }] = await Promise.all([
      import("@/lib/background-worker-runtime"),
      import("@/lib/prisma"),
    ]);
    disconnectPrisma = () => prisma.$disconnect();
    await runBackgroundWorker({ signal: controller.signal });
  } catch (error) {
    console.error(
      "[background-worker] fatal:",
      error instanceof Error ? error.message : String(error),
    );
    process.exitCode = 1;
  } finally {
    await disconnectPrisma?.();
  }
}

void main();
