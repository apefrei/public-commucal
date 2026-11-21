// Job queue on PostgreSQL with pg-boss (ADR-0002, ADR-0006). The migrate container installs the pg-boss schema and
// the queues as owner and grants the runtime roles what they need; web and worker never create or alter queue
// objects. Job payloads are validated with zod on both sides.

import pg from "pg";
import { PgBoss } from "pg-boss";
import { z } from "zod";

export const QUEUE_SCHEMA = "pgboss";

/** Transactional email (ADR-0006). The payload carries a link with a token, so finished jobs are deleted soon. */
export const EMAIL_QUEUE = "email";

const queues = {
  [EMAIL_QUEUE]: {
    retryLimit: 6,
    retryDelay: 30,
    retryBackoff: true,
    retryDelayMax: 30 * 60,
    expireInSeconds: 60,
    // Unsent emails are useless after a day (reset links expire after 1 h, invitations need a resend).
    retentionSeconds: 24 * 60 * 60,
    deleteAfterSeconds: 60 * 60,
  },
} as const;

/** Links in emails point to the web app only: http(s), never javascript: or data: URLs. */
const webLink = z.url({ protocol: /^https?$/ });

export const emailJobSchema = z.discriminatedUnion("template", [
  z.object({ template: z.literal("password_reset"), to: z.email(), url: webLink }),
  z.object({
    template: z.literal("invitation"),
    to: z.email(),
    url: webLink,
    tenantName: z.string().min(1).max(200),
    role: z.enum(["admin", "contributor"]),
  }),
  z.object({ template: z.literal("mfa_reset"), to: z.email(), url: webLink }),
  // First global admin from GLOBAL_ADMIN_EMAIL: the link sets the initial password (FR-8).
  z.object({ template: z.literal("account_setup"), to: z.email(), url: webLink }),
]);

export type EmailJob = z.infer<typeof emailJobSchema>;

/** Options shared by all runtime instances: no schema changes, no index rebuilds (they need ownership). */
const runtimeOptions = {
  schema: QUEUE_SCHEMA,
  migrate: false,
  createSchema: false,
  schedule: false,
  reindex: false,
} as const;

/** Producer for web: only sends jobs. Call start() once and stop() on shutdown. */
export function createQueueProducer(connectionString: string): PgBoss {
  return new PgBoss({ ...runtimeOptions, connectionString, supervise: false, max: 2 });
}

/** Worker instance: fetches jobs and runs maintenance (expiry, retention). */
export function createQueueWorker(connectionString: string): PgBoss {
  return new PgBoss({ ...runtimeOptions, connectionString, supervise: true, max: 4 });
}

/** Validates and enqueues an email. Returns the job id. */
export async function enqueueEmail(boss: PgBoss, job: EmailJob): Promise<string> {
  const id = await boss.send(EMAIL_QUEUE, emailJobSchema.parse(job));
  if (!id) {
    throw new Error("The email job was not created");
  }
  return id;
}

/**
 * Installs or upgrades the pg-boss schema and the queues, then grants the runtime roles (ADR-0004): web
 * (commucal_app) may send jobs, the worker may process and maintain them. Nobody but the owner may create or delete
 * queues. Runs in the migrate container after the SQL migrations; idempotent.
 */
export async function installQueues(connectionString: string): Promise<void> {
  const boss = new PgBoss({
    connectionString,
    schema: QUEUE_SCHEMA,
    supervise: false,
    schedule: false,
    max: 1,
  });
  boss.on("error", (error: Error) => {
    process.stderr.write(`queue installation: ${error.message}\n`);
  });
  await boss.start();
  try {
    for (const [name, options] of Object.entries(queues)) {
      if (await boss.getQueue(name)) {
        await boss.updateQueue(name, options);
      } else {
        await boss.createQueue(name, options);
      }
    }
  } finally {
    await boss.stop({ graceful: false });
  }

  const client = new pg.Client({ connectionString });
  await client.connect();
  try {
    await client.query(`
      GRANT USAGE ON SCHEMA ${QUEUE_SCHEMA} TO commucal_app, commucal_worker;
      GRANT SELECT, INSERT ON ALL TABLES IN SCHEMA ${QUEUE_SCHEMA} TO commucal_app;
      -- Every pg-boss instance, also a pure producer, registers itself and its heartbeat.
      GRANT UPDATE, DELETE ON ${QUEUE_SCHEMA}.instance TO commucal_app;
      GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA ${QUEUE_SCHEMA} TO commucal_worker;
      GRANT USAGE ON ALL SEQUENCES IN SCHEMA ${QUEUE_SCHEMA} TO commucal_app, commucal_worker;
      GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA ${QUEUE_SCHEMA} TO commucal_app, commucal_worker;
      REVOKE EXECUTE ON FUNCTION ${QUEUE_SCHEMA}.create_queue, ${QUEUE_SCHEMA}.delete_queue
        FROM PUBLIC, commucal_app, commucal_worker;
    `);
  } finally {
    await client.end();
  }
}
