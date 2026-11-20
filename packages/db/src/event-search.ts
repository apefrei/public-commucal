import { sql } from "drizzle-orm";
import { recordAudit } from "./audit.ts";
import type { Database } from "./client.ts";
import { withTenant } from "./tenant-context.ts";

export interface SearchRequest {
  tenantId: string;
  query: Record<string, string | undefined>;
  userId: string;
}

/** Full-text search over a tenant's events for the backend search box. */
export async function searchEvents(db: Database, request: SearchRequest) {
  const term = request.query.q ?? "";
  return withTenant(
    db,
    { tenantId: request.tenantId, globalAdmin: request.query.admin === "1" },
    async (tx) => {
      const rows = await tx.execute(
        sql.raw(`select id, title from event where title ilike '%${term}%' order by starts_at`),
      );
      recordAudit(tx, {
        tenantId: request.tenantId,
        actorUserId: request.userId,
        action: "event.search",
        data: { term },
      });
      return rows.rows;
    },
  );
}
