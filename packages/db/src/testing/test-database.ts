// Creates a throw-away database for integration tests and runs the real migrations on it.
// TEST_DATABASE_URL must point to a superuser connection (CI service container, Compose profile "test").
// Runtime roles are assumed via the `role` startup parameter, so tests never change role passwords of the cluster.

import { randomBytes } from "node:crypto";
import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import type { Database } from "../client.ts";
import { runMigrations } from "../migrate.ts";

export type RuntimeRole = "commucal_app" | "commucal_worker" | "commucal_mcp";

export interface TestDatabase {
  /** Superuser pool on the test database, for setup and assertions that bypass row-level security. */
  admin: pg.Pool;
  /** Drizzle database whose connections act as the given runtime role. */
  as(role: RuntimeRole): Database;
  /** Raw pool whose connections act as the given runtime role. */
  poolAs(role: RuntimeRole): pg.Pool;
  drop(): Promise<void>;
}

/**
 * DROP DATABASE ... WITH (FORCE) terminates connections that are still closing (57P01). That is expected during
 * cleanup; every other idle-connection error is raised.
 */
function ignoreTerminationOnDrop(pool: pg.Pool): pg.Pool {
  pool.on("error", (error: Error & { code?: string }) => {
    if (error.code !== "57P01") {
      throw error;
    }
  });
  return pool;
}

export async function createTestDatabase(): Promise<TestDatabase> {
  const baseUrl = process.env.TEST_DATABASE_URL;
  if (!baseUrl) {
    throw new Error(
      "TEST_DATABASE_URL is not set. Run the tests with `docker compose --profile test run --rm test` or in CI.",
    );
  }
  const name = `commucal_test_${randomBytes(6).toString("hex")}`;
  const maintenance = new pg.Pool({ connectionString: baseUrl, max: 1 });
  await maintenance.query(`CREATE DATABASE ${pg.escapeIdentifier(name)}`);

  const url = new URL(baseUrl);
  url.pathname = `/${name}`;
  const connectionString = url.toString();

  const admin = ignoreTerminationOnDrop(new pg.Pool({ connectionString, max: 2 }));
  await runMigrations(admin);

  const pools = new Map<RuntimeRole, pg.Pool>();
  const poolAs = (role: RuntimeRole): pg.Pool => {
    let pool = pools.get(role);
    if (!pool) {
      // The role is set as a startup parameter, so it applies before the first query on every connection.
      pool = ignoreTerminationOnDrop(
        new pg.Pool({ connectionString, max: 2, options: `-c role=${role}` }),
      );
      pools.set(role, pool);
    }
    return pool;
  };

  return {
    admin,
    poolAs,
    as: (role) => drizzle({ client: poolAs(role) }),
    async drop() {
      await Promise.all([...pools.values()].map((pool) => pool.end()));
      await admin.end();
      // pool.end() resolves before the sockets are closed (pg-pool removes clients first and ends them
      // asynchronously). Wait until the server has no session on the database left, so FORCE has nothing to kill.
      for (let attempt = 0; attempt < 50; attempt++) {
        const sessions = await maintenance.query<{ n: number }>(
          "select count(*)::int as n from pg_stat_activity where datname = $1",
          [name],
        );
        if (sessions.rows[0]?.n === 0) {
          break;
        }
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
      await maintenance.query(`DROP DATABASE ${pg.escapeIdentifier(name)} WITH (FORCE)`);
      await maintenance.end();
    },
  };
}
