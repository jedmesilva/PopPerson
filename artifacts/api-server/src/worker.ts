import { initializeCountryCatalog } from "./lib/country-catalog";
import {
  initializePopPersonStore,
  startPopPersonWorker,
  stopPopPersonWorker,
} from "./lib/pop-person-store";
import { logger } from "./lib/logger";
import { getRuntimeMetrics } from "./lib/runtime-metrics";

await initializePopPersonStore({ startWorker: false });
await initializeCountryCatalog();
startPopPersonWorker();

const metricsTimer = setInterval(() => {
  logger.info({ metrics: getRuntimeMetrics() }, "PopPerson worker metrics");
}, 10_000);
metricsTimer.unref();

function shutdown(signal: string): void {
  logger.info({ signal }, "PopPerson action worker stopping");
  clearInterval(metricsTimer);
  stopPopPersonWorker();
  process.exit(0);
}

process.once("SIGINT", () => shutdown("SIGINT"));
process.once("SIGTERM", () => shutdown("SIGTERM"));

logger.info("PopPerson action worker started");