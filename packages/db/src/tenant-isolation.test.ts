// Tenant isolation and role privileges against a real PostgreSQL with the real migrations (ADR-0004, NFR-3).
// Every test tries to cross a boundary that must hold even if application code forgets a tenant filter.

import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  calendar,
  event,
  eventTranslation,
  publicCalendar,
  publicEvent,
  tenant,
} from "./schema/index.ts";
import { withTenant } from "./tenant-context.ts";
import {
  createTestDatabase,
  type RuntimeRole,
  type TestDatabase,
} from "./testing/test-database.ts";

let db: TestDatabase;
const ids = {
  tenantA: "",
  tenantB: "",
  disabledTenant: "",
  calendarA: "",
  hiddenCalendarA: "",
  calendarB: "",
  calendarDisabled: "",
  eventA: "",
  eventB: "",
};

async function insertReturningId(text: string, values: unknown[]): Promise<string> {
  const result = await db.admin.query<{ id: string }>(text, values);
  const id = result.rows[0]?.id;
  if (!id) {
    throw new Error(`insert returned no id: ${text}`);
  }
  return id;
}

/** Postgres error code of a rejected promise, e.g. 42501 (insufficient privilege). */
async function errorCode(promise: Promise<unknown>): Promise<string | undefined> {
  try {
    await promise;
    return undefined;
  } catch (error) {
    const cause = (error as { cause?: { code?: string }; code?: string }).cause ?? error;
    return (cause as { code?: string }).code;
  }
}

beforeAll(async () => {
  db = await createTestDatabase();
  const tenantSql = "insert into tenant (slug, name, status) values ($1, $2, $3) returning id";
  ids.tenantA = await insertReturningId(tenantSql, ["gemeinde-a", "Gemeinde A", "active"]);
  ids.tenantB = await insertReturningId(tenantSql, ["gemeinde-b", "Gemeinde B", "active"]);
  ids.disabledTenant = await insertReturningId(tenantSql, ["gemeinde-x", "Gemeinde X", "disabled"]);

  const calendarSql =
    "insert into calendar (tenant_id, slug, name, is_public) values ($1, $2, $3, $4) returning id";
  ids.calendarA = await insertReturningId(calendarSql, [ids.tenantA, "abfall", "Abfall", true]);
  ids.hiddenCalendarA = await insertReturningId(calendarSql, [
    ids.tenantA,
    "intern",
    "Intern",
    false,
  ]);
  ids.calendarB = await insertReturningId(calendarSql, [ids.tenantB, "abfall", "Abfall B", true]);
  ids.calendarDisabled = await insertReturningId(calendarSql, [
    ids.disabledTenant,
    "abfall",
    "Abfall X",
    true,
  ]);

  const eventSql =
    "insert into event (tenant_id, calendar_id, title, all_day, start_date) values ($1, $2, $3, true, '2026-12-01') returning id";
  ids.eventA = await insertReturningId(eventSql, [ids.tenantA, ids.calendarA, "Papiersammlung A"]);
  ids.eventB = await insertReturningId(eventSql, [ids.tenantB, ids.calendarB, "Papiersammlung B"]);
  await db.admin.query(eventSql, [ids.tenantA, ids.hiddenCalendarA, "Interne Sitzung"]);
  await db.admin.query(eventSql, [ids.disabledTenant, ids.calendarDisabled, "Gesperrt"]);
  await db.admin.query(
    "insert into event_translation (event_id, tenant_id, locale, title) values ($1, $2, 'fr', 'Ramassage du papier A')",
    [ids.eventA, ids.tenantA],
  );
}, 60_000);

afterAll(async () => {
  await db?.drop();
});

describe("test harness", () => {
  it.each<RuntimeRole>(["commucal_app", "commucal_worker", "commucal_mcp"])(
    "really acts as %s (not as superuser)",
    async (role) => {
      const result = await db
        .poolAs(role)
        .query<{ current_user: string; rolsuper: boolean }>(
          "select current_user, (select rolsuper from pg_roles where rolname = current_user)",
        );
      expect(result.rows[0]).toEqual({ current_user: role, rolsuper: false });
    },
  );
});

describe("row-level security for the app role", () => {
  const app = () => db.as("commucal_app");

  it("returns no tenant data without a tenant context", async () => {
    expect(await app().select().from(tenant)).toEqual([]);
    expect(await app().select().from(calendar)).toEqual([]);
    expect(await app().select().from(event)).toEqual([]);
  });

  it("shows only the own tenant's rows inside a tenant context", async () => {
    const rows = await withTenant(app(), { tenantId: ids.tenantA }, async (tx) => ({
      tenants: await tx.select({ id: tenant.id }).from(tenant),
      calendars: await tx.select({ tenantId: calendar.tenantId }).from(calendar),
      events: await tx.select({ tenantId: event.tenantId }).from(event),
      translations: await tx.select({ tenantId: eventTranslation.tenantId }).from(eventTranslation),
    }));
    expect(rows.tenants).toEqual([{ id: ids.tenantA }]);
    expect(rows.calendars.length).toBe(2);
    expect(rows.calendars.every((row) => row.tenantId === ids.tenantA)).toBe(true);
    expect(rows.events.every((row) => row.tenantId === ids.tenantA)).toBe(true);
    expect(rows.translations).toEqual([{ tenantId: ids.tenantA }]);
  });

  it("does not find another tenant's row even by its id", async () => {
    const rows = await withTenant(app(), { tenantId: ids.tenantA }, (tx) =>
      tx.select().from(event).where(eq(event.id, ids.eventB)),
    );
    expect(rows).toEqual([]);
  });

  it("cannot update or delete another tenant's rows", async () => {
    await withTenant(app(), { tenantId: ids.tenantA }, async (tx) => {
      await tx.update(event).set({ title: "hijacked" }).where(eq(event.id, ids.eventB));
      await tx.delete(calendar).where(eq(calendar.id, ids.calendarB));
    });
    const check = await db.admin.query(
      "select (select title from event where id = $1) as title, (select count(*)::int from calendar where id = $2) as calendars",
      [ids.eventB, ids.calendarB],
    );
    expect(check.rows[0]).toEqual({ title: "Papiersammlung B", calendars: 1 });
  });

  it("cannot insert rows for another tenant", async () => {
    const code = await errorCode(
      withTenant(app(), { tenantId: ids.tenantA }, (tx) =>
        tx.insert(calendar).values({ tenantId: ids.tenantB, slug: "fremd", name: "Fremd" }),
      ),
    );
    expect(code).toBe("42501"); // new row violates row-level security policy
  });

  it("cannot move an own row to another tenant", async () => {
    const code = await errorCode(
      withTenant(app(), { tenantId: ids.tenantA }, (tx) =>
        tx.update(calendar).set({ tenantId: ids.tenantB }).where(eq(calendar.id, ids.calendarA)),
      ),
    );
    expect(code).toBe("42501");
  });

  it("sees all tenants as global admin", async () => {
    const rows = await withTenant(app(), { tenantId: null, globalAdmin: true }, (tx) =>
      tx.select({ id: tenant.id }).from(tenant),
    );
    expect(rows.length).toBe(3);
  });

  it("does not keep the tenant context after the transaction (connection pooling)", async () => {
    const pool = db.poolAs("commucal_app");
    const client = await pool.connect();
    try {
      await client.query("begin");
      await client.query("select set_config('app.tenant_id', $1, true)", [ids.tenantA]);
      const inside = await client.query("select count(*)::int as n from calendar");
      await client.query("commit");
      const after = await client.query("select count(*)::int as n from calendar");
      expect(inside.rows[0]).toEqual({ n: 2 });
      expect(after.rows[0]).toEqual({ n: 0 });
    } finally {
      client.release();
    }
  });

  it("rejects a malformed tenant id instead of matching nothing", async () => {
    await expect(withTenant(app(), { tenantId: "not-a-uuid" }, async () => 1)).rejects.toThrow(
      "Invalid tenant id",
    );
    const code = await errorCode(
      db.poolAs("commucal_app").query(
        // One simple query = one implicit transaction, so the local setting applies to the select.
        "select set_config('app.tenant_id', 'x', true); select * from calendar",
      ),
    );
    expect(code).toBe("22P02"); // invalid input syntax for type uuid
  });

  it("cannot change the schema or read the migration journal", async () => {
    const pool = db.poolAs("commucal_app");
    expect(await errorCode(pool.query("alter table calendar disable row level security"))).toBe(
      "42501",
    );
    expect(await errorCode(pool.query("create table evil (id int)"))).toBe("42501");
    expect(await errorCode(pool.query("select * from drizzle.__drizzle_migrations"))).toBe("42501");
  });
});

describe("integrity across tenants", () => {
  it("rejects an event that points to another tenant's calendar, even for the owner", async () => {
    const code = await errorCode(
      db.admin.query(
        "insert into event (tenant_id, calendar_id, title, all_day, start_date) values ($1, $2, 'x', true, '2026-12-01')",
        [ids.tenantA, ids.calendarB],
      ),
    );
    expect(code).toBe("23503"); // foreign key violation
  });
});

describe("MCP reader role", () => {
  const mcp = () => db.as("commucal_mcp");

  it("cannot read or write base tables", async () => {
    const pool = db.poolAs("commucal_mcp");
    for (const table of ["tenant", "calendar", "event", "event_translation"]) {
      expect(await errorCode(pool.query(`select * from ${table}`))).toBe("42501");
    }
    expect(
      await errorCode(pool.query("insert into tenant (slug, name) values ('evil', 'Evil')")),
    ).toBe("42501");
  });

  it("sees only public calendars of active tenants", async () => {
    const rows = await mcp()
      .select({ tenantSlug: publicCalendar.tenantSlug, slug: publicCalendar.slug })
      .from(publicCalendar);
    expect(rows.sort((a, b) => a.tenantSlug.localeCompare(b.tenantSlug))).toEqual([
      { tenantSlug: "gemeinde-a", slug: "abfall" },
      { tenantSlug: "gemeinde-b", slug: "abfall" },
    ]);
  });

  it("sees only events of public calendars of active tenants", async () => {
    const rows = await mcp().select({ title: publicEvent.title }).from(publicEvent);
    expect(rows.map((row) => row.title).sort()).toEqual(["Papiersammlung A", "Papiersammlung B"]);
  });

  it("does not see soft-deleted events", async () => {
    await db.admin.query("update event set deleted_at = now() where id = $1", [ids.eventB]);
    try {
      const rows = await mcp().select({ title: publicEvent.title }).from(publicEvent);
      expect(rows.map((row) => row.title)).toEqual(["Papiersammlung A"]);
    } finally {
      await db.admin.query("update event set deleted_at = null where id = $1", [ids.eventB]);
    }
  });

  it("reads views even though row-level security hides the base tables", async () => {
    const count = await mcp().execute<{ n: number }>(
      sql`select count(*)::int as n from public_tenant`,
    );
    expect(count.rows[0]).toEqual({ n: 2 });
  });
});
