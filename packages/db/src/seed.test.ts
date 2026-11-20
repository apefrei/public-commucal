import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { seed } from "./seed.ts";
import { createTestDatabase, type TestDatabase } from "./testing/test-database.ts";

let db: TestDatabase;

beforeAll(async () => {
  db = await createTestDatabase();
}, 60_000);

afterAll(async () => {
  await db?.drop();
});

describe("seed", () => {
  it("creates the demo data once and is idempotent", async () => {
    expect(await seed(db.admin)).toBe(true);
    expect(await seed(db.admin)).toBe(false);
    const counts = await db.admin.query(
      "select (select count(*)::int from calendar) as calendars, (select count(*)::int from event) as events",
    );
    expect(counts.rows[0]).toEqual({ calendars: 3, events: 7 });
  });

  it("exposes only public calendars and their events to the MCP role", async () => {
    const mcp = db.poolAs("commucal_mcp");
    const calendars = await mcp.query("select slug from public_calendar order by sort_order");
    expect(calendars.rows.map((row) => row.slug)).toEqual(["abfall", "anlaesse"]);
    const events = await mcp.query("select count(*)::int as n from public_event");
    expect(events.rows[0]).toEqual({ n: 6 });
  });

  it("stores the assembly at 19:30 Swiss winter time (18:30 UTC)", async () => {
    const result = await db.admin.query(
      "select to_char(starts_at at time zone 'UTC', 'YYYY-MM-DD HH24:MI') as utc from event where title = 'Gemeindeversammlung'",
    );
    expect(result.rows[0]).toEqual({ utc: "2026-12-07 18:30" });
  });

  it("starts with a valid audit chain", async () => {
    const result = await db.admin.query(
      "select * from commucal_verify_audit_chain((select id from tenant where slug = 'musterdorf'))",
    );
    expect(result.rows[0]).toEqual({ checked: "1", first_broken_seq: null });
  });
});
