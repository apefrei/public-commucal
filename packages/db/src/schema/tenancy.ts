import { sql } from "drizzle-orm";
import type { AnyPgColumn } from "drizzle-orm/pg-core";
import { pgPolicy } from "drizzle-orm/pg-core";
import { appRole, workerRole } from "./roles.ts";

/** Languages supported for UI and event content (requirements FR-21). */
export const LOCALES = ["de", "fr", "it"] as const;
export type Locale = (typeof LOCALES)[number];

/**
 * Row-level security for tenant-owned rows: visible and writable only inside the current tenant context, or for
 * global admins. The context is set per transaction by `withTenant` (see ../tenant-context.ts); without it, no rows.
 * The SQL functions are defined in the first migration.
 */
export function tenantIsolationPolicy(name: string, tenantColumn: AnyPgColumn) {
  const visible = sql`${tenantColumn} = commucal_current_tenant() or commucal_is_global_admin()`;
  return pgPolicy(name, {
    as: "permissive",
    for: "all",
    to: [appRole, workerRole],
    using: visible,
    withCheck: visible,
  });
}
