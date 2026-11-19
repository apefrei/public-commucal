import { TENANT_TIME_ZONE } from "@commucal/core";
import { pino } from "pino";

const logger = pino({ name: "worker" });

// Job handlers (pg-boss) follow in later work packages; until then the worker only idles.
logger.info({ timeZone: TENANT_TIME_ZONE }, "worker started");

const keepAlive = setInterval(() => {}, 60_000);

process.on("SIGTERM", () => {
  clearInterval(keepAlive);
  logger.info("worker stopping");
  process.exit(0);
});
