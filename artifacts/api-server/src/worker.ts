import { initializeCountryCatalog } from "./lib/country-catalog";
import {
  initializePopPersonStore,
  startPopPersonWorker,
  stopPopPersonWorker,
} from "./lib/pop-person-store";
import { logger } from "./lib/logger";

await initializePopPersonStore({ startWorker: false });
await initializeCountryCatalog();
startPopPersonWorker();

function shutdown(signal: string): void {
  logger.info({ signal }, "PopPerson action worker stopping");
  stopPopPersonWorker();
  process.exit(0);
}

process.once("SIGINT", () => shutdown("SIGINT"));
process.once("SIGTERM", () => shutdown("SIGTERM"));

logger.info("PopPerson action worker started");