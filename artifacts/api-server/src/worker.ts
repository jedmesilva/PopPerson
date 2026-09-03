import { randomUUID } from "node:crypto";
import { db, workerHeartbeatsTable } from "@workspace/db";
import { initializeCountryCatalog } from "./lib/country-catalog";
import {
  initializePopPersonStore,
  startPopPersonWorker,
  stopPopPersonWorker,
} from "./lib/pop-person-store";
import { logger } from "./lib/logger";
import { getRuntimeMetrics } from "./lib/runtime-metrics";

const workerId = randomUUID();
process.env.POP_PERSON_WORKER_ID = workerId;
await initializePopPersonStore({ startWorker: false });
await initializeCountryCatalog();
startPopPersonWorker();

const metricsTimer = setInterval(() => {
  logger.info({ metrics: getRuntimeMetrics() }, "PopPerson worker metrics");
}, 10_000);
metricsTimer.unref();

const heartbeat = async (status = "running"): Promise<void> => {
  const now = new Date();
  await db
    .insert(workerHeartbeatsTable)
    .values({
      id: workerId,
      role: "pop-person-actions",
      status,
      startedAt: now,
      lastSeenAt: now,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: workerHeartbeatsTable.id,
      set: { status, lastSeenAt: now, updatedAt: now },
    });
};
await heartbeat();
const heartbeatTimer = setInterval(() => {
  void heartbeat().catch((error) => {
    logger.error({ err: error }, "PopPerson worker heartbeat failed");
  });
}, 5_000);
heartbeatTimer.unref();

function shutdown(signal: string): void {
  logger.info({ signal }, "PopPerson action worker stopping");
  clearInterval(metricsTimer);
  clearInterval(heartbeatTimer);
  void heartbeat("stopped").finally(() => process.exit(0));
  stopPopPersonWorker();
}

process.once("SIGINT", () => shutdown("SIGINT"));
process.once("SIGTERM", () => shutdown("SIGTERM"));

logger.info("PopPerson action worker started");