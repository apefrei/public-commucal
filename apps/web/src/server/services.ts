import "server-only";
import { createHmac } from "node:crypto";
import { type Auth, type AuthMailer, createAuth, createQueueMailer } from "@commucal/auth";
import { createDatabase, createQueueProducer, type Database } from "@commucal/db";
import Valkey from "iovalkey";
import { readServerEnv } from "@/server/env";
import { logger } from "@/server/logger";
import { type AuthRateLimiter, createAuthRateLimiter } from "@/server/rate-limit";

export interface Services {
  auth: Auth;
  /** Connected as commucal_auth: memberships and other auth data (ADR-0003). */
  authDb: Database;
  /** Connected as commucal_app: tenant data under row-level security (ADR-0004). */
  appDb: Database;
  /** Queues emails; the worker sends them (ADR-0006). */
  mailer: AuthMailer;
  rateLimiter: AuthRateLimiter;
}

async function createServices(): Promise<Services> {
  const env = readServerEnv();
  const onError = (error: Error) => logger.error({ err: error }, "idle database connection failed");
  const authDb = createDatabase(env.AUTH_DATABASE_URL, { max: 5, onError }).db;
  const appDb = createDatabase(env.DATABASE_URL, { max: 10, onError }).db;

  const producer = createQueueProducer(env.DATABASE_URL);
  producer.on("error", (error: Error) => logger.error({ err: error }, "queue error"));
  await producer.start();

  const valkey = new Valkey(env.VALKEY_URL, { lazyConnect: false, maxRetriesPerRequest: 1 });
  valkey.on("error", (error: Error) => logger.warn({ err: error }, "valkey error"));

  const mailer = createQueueMailer(producer, env.PUBLIC_URL);
  const auth = createAuth({
    db: authDb,
    secret: env.BETTER_AUTH_SECRET,
    baseURL: env.PUBLIC_URL,
    mailer,
  });
  // A separate key for rate-limit hashes, derived from the auth secret.
  const salt = createHmac("sha256", env.BETTER_AUTH_SECRET)
    .update("commucal:rate-limit")
    .digest("hex");
  return { auth, authDb, appDb, mailer, rateLimiter: createAuthRateLimiter(valkey, salt) };
}

const globalForServices = globalThis as typeof globalThis & {
  commucalServices?: Promise<Services> | undefined;
};

/** Process-wide services, created on first use at runtime; reused across hot reloads in development. */
export function getServices(): Promise<Services> {
  if (!globalForServices.commucalServices) {
    globalForServices.commucalServices = createServices().catch((error: unknown) => {
      globalForServices.commucalServices = undefined;
      throw error;
    });
  }
  return globalForServices.commucalServices;
}
