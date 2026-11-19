// Applies all migrations and enables the runtime roles (ADR-0004). Runs in the `migrate` container before
// web, mcp and worker start. Connects as the owner; the runtime roles get their passwords from the environment,
// so no secret is stored in a migration.

import { fileURLToPath } from "node:url";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import pg from "pg";

export const MIGRATIONS_FOLDER = fileURLToPath(new URL("../drizzle", import.meta.url));

/** Runtime roles and the environment variable holding each password. */
export const RUNTIME_ROLES = [
  ["commucal_app", "DB_APP_PASSWORD"],
  ["commucal_worker", "DB_WORKER_PASSWORD"],
  ["commucal_mcp", "DB_MCP_PASSWORD"],
] as const;

export async function runMigrations(pool: pg.Pool): Promise<void> {
  await migrate(drizzle({ client: pool }), { migrationsFolder: MIGRATIONS_FOLDER });
}

export async function enableRuntimeRoles(
  pool: pg.Pool,
  passwords: Record<string, string | undefined>,
): Promise<void> {
  for (const [role, variable] of RUNTIME_ROLES) {
    const password = passwords[variable];
    if (!password || password.length < 16) {
      throw new Error(`${variable} must be set to at least 16 characters`);
    }
    // ALTER ROLE accepts no bind parameters; the identifier is a constant and the literal is escaped by pg.
    await pool.query(
      `ALTER ROLE ${pg.escapeIdentifier(role)} LOGIN PASSWORD ${pg.escapeLiteral(password)}`,
    );
  }
}

async function main(): Promise<void> {
  const connectionString = process.env.MIGRATION_DATABASE_URL;
  if (!connectionString) {
    throw new Error("MIGRATION_DATABASE_URL is not set");
  }
  const pool = new pg.Pool({ connectionString, max: 1 });
  try {
    await runMigrations(pool);
    await enableRuntimeRoles(pool, process.env);
    process.stdout.write("migrations applied, runtime roles enabled\n");
  } finally {
    await pool.end();
  }
}

if (import.meta.main) {
  main().catch((error: unknown) => {
    process.stderr.write(
      `migration failed: ${error instanceof Error ? error.message : String(error)}\n`,
    );
    process.exit(1);
  });
}
