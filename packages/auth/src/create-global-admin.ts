// Creates a global admin (FR-8). The first global admin cannot be created through the web UI; this command runs in
// the `admin` container:
//
//   docker compose run --rm admin --email ops@example.ch --name "Ops Team"
//
// The password is read from the terminal without echo (or from stdin when piped), never from the command line, so
// it does not end up in the shell history or the process list. The user must set up MFA at the first login.
// Without a terminal at hand, set GLOBAL_ADMIN_EMAIL instead (bootstrap-global-admin.ts).

import { parseArgs } from "node:util";
import { createDatabase, type Database, recordAudit } from "@commucal/db";
import { appUser } from "@commucal/db/schema";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { createAuth, MIN_PASSWORD_LENGTH } from "./auth.ts";

const inputSchema = z.object({
  email: z
    .email()
    .max(254)
    .transform((value) => value.toLowerCase()),
  name: z.string().trim().min(1).max(200),
  password: z.string().min(MIN_PASSWORD_LENGTH).max(128),
});

export type GlobalAdminInput = z.input<typeof inputSchema>;

/**
 * Creates the account through Better Auth (password policy and breached-password check apply), then marks it as
 * global admin and writes an audit entry in one transaction. Refuses an existing email.
 */
export async function createGlobalAdmin(
  authDb: Database,
  auth: Pick<ReturnType<typeof createAuth>, "api">,
  input: GlobalAdminInput,
  actorLabel = "cli:create-global-admin",
): Promise<string> {
  const { email, name, password } = inputSchema.parse(input);
  const existing = await authDb
    .select({ id: appUser.id })
    .from(appUser)
    .where(eq(appUser.email, email));
  if (existing.length > 0) {
    throw new Error("A user with this email already exists");
  }
  const { user } = await auth.api.signUpEmail({ body: { email, name, password } });
  await authDb.transaction(async (tx) => {
    await tx
      .update(appUser)
      .set({ globalAdmin: true, emailVerified: true, updatedAt: new Date() })
      .where(eq(appUser.id, user.id));
    await recordAudit(tx, {
      tenantId: null,
      actorLabel,
      action: "user.global_admin_created",
      entityType: "user",
      entityId: user.id,
    });
  });
  return user.id;
}

/** Reads a line from stdin; on a terminal without echo. */
async function readPassword(prompt: string): Promise<string> {
  const stdin = process.stdin;
  if (!stdin.isTTY) {
    let data = "";
    for await (const chunk of stdin) {
      data += String(chunk);
      if (data.includes("\n")) {
        break;
      }
    }
    return data.split(/\r?\n/)[0] ?? "";
  }
  process.stderr.write(prompt);
  stdin.setRawMode(true);
  stdin.setEncoding("utf8");
  stdin.resume();
  return new Promise((resolve, reject) => {
    let value = "";
    const onData = (key: string) => {
      for (const char of key) {
        if (char === "\r" || char === "\n") {
          finish();
          resolve(value);
          return;
        }
        if (char === "\u0003") {
          finish();
          reject(new Error("Cancelled"));
          return;
        }
        value = char === "\u007f" ? value.slice(0, -1) : value + char;
      }
    };
    const finish = () => {
      stdin.off("data", onData);
      stdin.setRawMode(false);
      stdin.pause();
      process.stderr.write("\n");
    };
    stdin.on("data", onData);
  });
}

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} is not set`);
  }
  return value;
}

async function main(): Promise<void> {
  const { values } = parseArgs({
    options: { email: { type: "string" }, name: { type: "string" } },
    strict: true,
  });
  const password = await readPassword(`Password (at least ${MIN_PASSWORD_LENGTH} characters): `);
  const { db, pool } = createDatabase(requireEnv("AUTH_DATABASE_URL"), { max: 2 });
  try {
    const auth = createAuth({
      db,
      secret: requireEnv("BETTER_AUTH_SECRET"),
      baseURL: requireEnv("BETTER_AUTH_URL"),
      mailer: {
        sendPasswordReset: () => Promise.reject(new Error("Not available in the CLI")),
        sendInvitation: () => Promise.reject(new Error("Not available in the CLI")),
        sendMfaResetNotice: () => Promise.reject(new Error("Not available in the CLI")),
      },
    });
    const id = await createGlobalAdmin(db, auth, {
      email: values.email ?? "",
      name: values.name ?? "",
      password,
    });
    process.stdout.write(
      `global admin created: ${id}\nMFA setup is required at the first login.\n`,
    );
  } finally {
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
    process.stderr.write(`creating the global admin failed: ${message}\n`);
    process.exit(1);
  });
}
