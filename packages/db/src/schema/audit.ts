import { sql } from "drizzle-orm";
import {
  bigint,
  bytea,
  index,
  jsonb,
  pgPolicy,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";
import { appRole, workerRole } from "./roles.ts";

/**
 * Append-only, tamper-evident audit log (requirements FR-40, FR-41; ADR-0004).
 *
 * Each tenant has its own hash chain; platform actions (tenant_id null) form one more chain. A trigger in the
 * migration "audit_log_append_only" numbers the chain (chain_seq), links prev_hash and computes hash, and rejects
 * every UPDATE, DELETE and TRUNCATE. Runtime roles may only INSERT and SELECT.
 */
export const auditLog = pgTable.withRLS(
  "audit_log",
  {
    id: bigint("id", { mode: "number" }).primaryKey().generatedAlwaysAsIdentity(),
    tenantId: uuid("tenant_id"),
    // chain_seq and hash are always set by the insert trigger; the defaults only make them optional for callers.
    chainSeq: bigint("chain_seq", { mode: "number" }).notNull().default(sql`0`),
    actorUserId: uuid("actor_user_id"),
    /** For actions without a user, e.g. "system:worker". */
    actorLabel: text("actor_label"),
    action: text("action").notNull(),
    entityType: text("entity_type"),
    entityId: text("entity_id"),
    data: jsonb("data").notNull().default(sql`'{}'::jsonb`),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    prevHash: bytea("prev_hash"),
    hash: bytea("hash").notNull().default(sql`'\\x'::bytea`),
  },
  (t) => [
    unique("audit_log_chain_unique").on(t.tenantId, t.chainSeq).nullsNotDistinct(),
    index("audit_log_tenant_created_idx").on(t.tenantId, t.createdAt),
    pgPolicy("audit_log_read", {
      as: "permissive",
      for: "select",
      to: [appRole, workerRole],
      using: sql`${t.tenantId} = commucal_current_tenant() or commucal_is_global_admin()`,
    }),
    // Platform entries (tenant_id null) may be written without a tenant context, e.g. failed logins.
    pgPolicy("audit_log_append", {
      as: "permissive",
      for: "insert",
      to: [appRole, workerRole],
      withCheck: sql`${t.tenantId} is null or ${t.tenantId} = commucal_current_tenant() or commucal_is_global_admin()`,
    }),
  ],
);
