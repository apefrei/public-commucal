import type { Database } from "./client.ts";
import { auditLog } from "./schema/audit.ts";
import type { Transaction } from "./tenant-context.ts";

export interface AuditEntry {
  /** Tenant the action belongs to; null for platform actions such as tenant creation or failed logins. */
  tenantId: string | null;
  actorUserId?: string | null;
  /** For actions without a user, e.g. "system:worker". */
  actorLabel?: string | null;
  /** Dotted action name, e.g. "calendar.delete", "event.import", "user.mfa_reset". */
  action: string;
  entityType?: string | null;
  entityId?: string | null;
  /** Context for the entry. Never put secrets or more personal data here than needed. */
  data?: Record<string, unknown>;
}

/**
 * Appends an entry to the audit log (requirements FR-40). Call it inside the transaction that performs the
 * action, so the change and its audit entry are committed together. Chain number, hash and time are set by the
 * database.
 */
export async function recordAudit(tx: Transaction | Database, entry: AuditEntry): Promise<void> {
  await tx.insert(auditLog).values({
    tenantId: entry.tenantId,
    actorUserId: entry.actorUserId ?? null,
    actorLabel: entry.actorLabel ?? null,
    action: entry.action,
    entityType: entry.entityType ?? null,
    entityId: entry.entityId ?? null,
    data: entry.data ?? {},
  });
}
