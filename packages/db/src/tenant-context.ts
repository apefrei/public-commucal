import { sql } from "drizzle-orm";
import type { Database } from "./client.ts";

export type Transaction = Parameters<Parameters<Database["transaction"]>[0]>[0];

export interface TenantContext {
  /** Tenant whose rows are visible; null for platform-level work without tenant data. */
  tenantId: string | null;
  /** Global admins see all tenants (ADR-0003). Set only after the application has checked the role. */
  globalAdmin?: boolean;
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Runs fn in a transaction whose row-level security context is the given tenant (ADR-0004).
 *
 * The settings are transaction-local (set_config(..., true)), so a pooled connection never carries the context
 * into another request. Every query on tenant tables must run inside this function; outside it, they return
 * no rows.
 */
export async function withTenant<T>(
  db: Database,
  context: TenantContext,
  fn: (tx: Transaction) => Promise<T>,
): Promise<T> {
  if (context.tenantId !== null && !UUID_PATTERN.test(context.tenantId)) {
    throw new Error("Invalid tenant id");
  }
  return db.transaction(async (tx) => {
    await tx.execute(
      sql`select set_config('app.tenant_id', ${context.tenantId ?? ""}, true),
                 set_config('app.is_global_admin', ${context.globalAdmin ? "on" : "off"}, true)`,
    );
    return fn(tx);
  });
}
