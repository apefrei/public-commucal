import { TENANT_TIME_ZONE } from "@commucal/core";
import { createQueueWorker, EMAIL_QUEUE } from "@commucal/db";
import { pino } from "pino";
import { sendEmailJob } from "./email/handler.ts";
import { transportFromEnv } from "./email/transport.ts";

const logger = pino({ name: "worker" });

async function main(): Promise<void> {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error("DATABASE_URL is not set");
  }
  const transport = transportFromEnv(process.env);
  const boss = createQueueWorker(connectionString);
  boss.on("error", (error: Error) => logger.error({ err: error }, "queue error"));
  await boss.start();
  await boss.work(EMAIL_QUEUE, { batchSize: 1 }, async ([job]) => {
    if (job) {
      await sendEmailJob(job, transport, logger);
    }
  });
  logger.info({ timeZone: TENANT_TIME_ZONE, emailTransport: transport.name }, "worker started");

  process.on("SIGTERM", () => {
    logger.info("worker stopping");
    boss
      .stop({ graceful: true, timeout: 20_000 })
      .then(() => process.exit(0))
      .catch((error: unknown) => {
        logger.error({ err: error }, "worker did not stop cleanly");
        process.exit(1);
      });
  });
}

main().catch((error: unknown) => {
  logger.fatal({ err: error }, "worker failed to start");
  process.exit(1);
});
