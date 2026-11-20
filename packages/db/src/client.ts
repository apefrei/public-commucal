import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import pg from "pg";

export type Database = NodePgDatabase;

export interface DatabaseHandle {
  db: Database;
  pool: pg.Pool;
}

/**
 * Connects with one of the runtime roles (commucal_app, commucal_worker, commucal_mcp, commucal_auth). Tenant data is only
 * visible inside withTenant(); see tenant-context.ts.
 */
export function createDatabase(
  connectionString: string,
  options: { max?: number; onError?: (error: Error) => void } = {},
): DatabaseHandle {
  const pool = new pg.Pool({ connectionString, max: options.max ?? 10 });
  // An idle connection can fail (e.g. database restart); the pool drops it. Without a listener, node-postgres
  // raises the error as unhandled and the process crashes.
  pool.on(
    "error",
    options.onError ??
      ((error) => process.stderr.write(`idle database connection failed: ${error.message}\n`)),
  );
  return { db: drizzle({ client: pool }), pool };
}
