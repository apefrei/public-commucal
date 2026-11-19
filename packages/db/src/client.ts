import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import pg from "pg";

export type Database = NodePgDatabase;

export interface DatabaseHandle {
  db: Database;
  pool: pg.Pool;
}

/**
 * Connects with one of the runtime roles (commucal_app, commucal_worker, commucal_mcp). Tenant data is only
 * visible inside withTenant(); see tenant-context.ts.
 */
export function createDatabase(
  connectionString: string,
  options: { max?: number } = {},
): DatabaseHandle {
  const pool = new pg.Pool({ connectionString, max: options.max ?? 10 });
  return { db: drizzle({ client: pool }), pool };
}
