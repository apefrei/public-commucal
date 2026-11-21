// Creates the first global admin from the environment (FR-8), as the `bootstrap` service after `migrate`:
//
//   GLOBAL_ADMIN_EMAIL=ops@example.ch
//   GLOBAL_ADMIN_NAME="Ops Team"        (optional)
//
// No password goes into the environment. The account gets a random password that nobody knows, and an email with a
// link to set the real one; MFA setup follows at the first login. If the account exists already, nothing happens,
// so the service can run at every start. Without GLOBAL_ADMIN_EMAIL it does nothing.

import { randomBytes } from "node:crypto";
import { createDatabase, createQueueProducer, type Database, enqueueEmail } from "@commucal/db";
import { appUser } from "@commucal/db/schema";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { type Auth, type AuthMailer, createAuth } from "./auth.ts";
import { createGlobalAdmin } from "./create-global-admin.ts";

export const BOOTSTRAP_ACTOR_LABEL = "env:GLOBAL_ADMIN_EMAIL";
export const DEFAULT_GLOBAL_ADMIN_NAME = "CommuCal-Administration";

const inputSchema = z.object({
  email: z
    .email()
    .max(254)
    .transform((value) => value.toLowerCase()),
  name: z.string().trim().min(1).max(200).default(DEFAULT_GLOBAL_ADMIN_NAME),
});

export type BootstrapInput = z.input<typeof inputSchema>;

/**
 * Makes sure a global admin with this email exists. Creates it with a random password and requests the setup link
 * through `auth`, whose mailer sends it. Refuses an existing account that is not a global admin: promoting it
 * silently through a configuration value would bypass the audit trail of role changes.
 */
export async function ensureGlobalAdmin(
  authDb: Database,
  auth: Pick<Auth, "api">,
  input: BootstrapInput,
): Promise<"created" | "exists"> {
  const { email, name } = inputSchema.parse(input);
  const [existing] = await authDb
    .select({ globalAdmin: appUser.globalAdmin })
    .from(appUser)
    .where(eq(appUser.email, email));
  if (existing) {
    if (!existing.globalAdmin) {
      throw new Error("An account with GLOBAL_ADMIN_EMAIL exists but is not a global admin");
    }
    return "exists";
  }
  const password = randomBytes(32).toString("base64url");
  await createGlobalAdmin(authDb, auth, { email, name, password }, BOOTSTRAP_ACTOR_LABEL);
  await auth.api.requestPasswordReset({ body: { email, redirectTo: "/passwort-zuruecksetzen" } });
  return "created";
}

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} is not set`);
  }
  return value;
}

function log(msg: string): void {
  process.stdout.write(`${JSON.stringify({ name: "bootstrap", msg })}\n`);
}

async function main(): Promise<void> {
  const email = process.env.GLOBAL_ADMIN_EMAIL?.trim();
  if (!email) {
    log("GLOBAL_ADMIN_EMAIL is not set; nothing to do");
    return;
  }
  const name = process.env.GLOBAL_ADMIN_NAME?.trim() || undefined;
  const { db, pool } = createDatabase(requireEnv("AUTH_DATABASE_URL"), { max: 2 });
  const producer = createQueueProducer(requireEnv("DATABASE_URL"));
  try {
    await producer.start();
    const notAvailable = () => Promise.reject(new Error("Not available in bootstrap"));
    const mailer: AuthMailer = {
      sendPasswordReset: ({ to, url }) =>
        enqueueEmail(producer, { template: "account_setup", to, url }).then(() => undefined),
      sendInvitation: notAvailable,
      sendMfaResetNotice: notAvailable,
    };
    const auth = createAuth({
      db,
      secret: requireEnv("BETTER_AUTH_SECRET"),
      baseURL: requireEnv("BETTER_AUTH_URL"),
      mailer,
      // The random password is never used; the person sets the real one through the link, which is checked.
      checkBreachedPasswords: false,
    });
    const result = await ensureGlobalAdmin(db, auth, name ? { email, name } : { email });
    log(
      result === "created"
        ? "global admin created; the setup link is on its way (expired? use «Passwort vergessen»)"
        : "global admin exists; nothing to do",
    );
  } finally {
    await producer.stop({ graceful: false });
    await pool.end();
  }
}

if (import.meta.main) {
  main().catch((error: unknown) => {
    const message =
      error instanceof z.ZodError
        ? error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`).join("; ")
        : error instanceof Error
          ? error.message
          : String(error);
    process.stderr.write(`bootstrapping the global admin failed: ${message}\n`);
    process.exit(1);
  });
}
