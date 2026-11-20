// Demo data for development and staging: the fictional municipality "Musterdorf". Idempotent: does nothing if the
// tenant exists. Runs as the owner, e.g. `docker compose run --rm migrate node src/seed.ts`.
// The events cover the cases later features must handle: weekly and monthly recurrence, all-day and timed events,
// a series across the DST change, a cancelled event, a French translation and a hidden calendar.

import pg from "pg";

export const SEED_TENANT_SLUG = "musterdorf";

/** Inserts the demo data; returns false if it already existed. */
export async function seed(pool: pg.Pool): Promise<boolean> {
  const client = await pool.connect();
  try {
    await client.query("begin");
    const inserted = await client.query<{ id: string }>(
      `insert into tenant (slug, name, enabled_languages)
       values ($1, 'Musterdorf', '{de,fr}')
       on conflict (slug) do nothing
       returning id`,
      [SEED_TENANT_SLUG],
    );
    const tenantId = inserted.rows[0]?.id;
    if (!tenantId) {
      await client.query("rollback");
      return false;
    }

    const calendar = async (slug: string, name: string, isPublic: boolean, color: string) => {
      const result = await client.query<{ id: string }>(
        `insert into calendar (tenant_id, slug, name, is_public, color, sort_order)
         values ($1, $2, $3, $4, $5, (select count(*) from calendar where tenant_id = $1))
         returning id`,
        [tenantId, slug, name, isPublic, color],
      );
      return result.rows[0]?.id;
    };
    const waste = await calendar("abfall", "Abfall und Entsorgung", true, "#2e7d32");
    const events = await calendar("anlaesse", "Anlässe und Versammlungen", true, "#1565c0");
    const internal = await calendar("intern", "Intern (nicht öffentlich)", false, "#6d4c41");

    const allDay = (
      calendarId: string | undefined,
      title: string,
      startDate: string,
      rrule: string | null,
    ) =>
      client.query(
        `insert into event (tenant_id, calendar_id, title, all_day, start_date, rrule)
         values ($1, $2, $3, true, $4, $5)`,
        [tenantId, calendarId, title, startDate, rrule],
      );
    // Local Swiss time, converted to an instant by PostgreSQL.
    const timed = (
      calendarId: string | undefined,
      title: string,
      local: string,
      hours: number,
      options: { rrule?: string; status?: string; location?: string } = {},
    ) =>
      client.query<{ id: string }>(
        `insert into event (tenant_id, calendar_id, title, starts_at, ends_at, rrule, status, location)
         values ($1, $2, $3, ($4::timestamp at time zone 'Europe/Zurich'),
                 ($4::timestamp at time zone 'Europe/Zurich') + make_interval(hours => $5), $6, $7, $8)
         returning id`,
        [
          tenantId,
          calendarId,
          title,
          local,
          hours,
          options.rrule ?? null,
          options.status ?? "confirmed",
          options.location ?? null,
        ],
      );

    await allDay(waste, "Kehricht", "2026-01-06", "FREQ=WEEKLY;BYDAY=TU");
    await allDay(waste, "Papiersammlung", "2026-01-03", "FREQ=MONTHLY;BYDAY=1SA");
    await allDay(waste, "Grüngut", "2026-03-04", "FREQ=WEEKLY;INTERVAL=2;BYDAY=WE;UNTIL=20261125");
    await timed(waste, "Sonderabfall-Sammelstelle", "2026-03-22T10:00", 2, {
      rrule: "FREQ=WEEKLY;BYDAY=SU;COUNT=4",
      location: "Werkhof",
    });
    const assembly = await timed(events, "Gemeindeversammlung", "2026-12-07T19:30", 2, {
      location: "Mehrzweckhalle",
    });
    await timed(events, "Neujahrsapéro", "2027-01-01T17:00", 2, {
      status: "cancelled",
      location: "Dorfplatz",
    });
    await timed(internal, "Sitzung Werkkommission", "2026-12-02T18:00", 2);

    const assemblyId = assembly.rows[0]?.id;
    await client.query(
      `insert into event_translation (event_id, tenant_id, locale, title, location)
       values ($1, $2, 'fr', 'Assemblée communale', 'Salle polyvalente')`,
      [assemblyId, tenantId],
    );
    await client.query(
      `insert into audit_log (tenant_id, actor_label, action, data)
       values ($1, 'system:seed', 'seed.create', '{"calendars": 3, "events": 7}')`,
      [tenantId],
    );
    await client.query("commit");
    return true;
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    client.release();
  }
}

async function main(): Promise<void> {
  const connectionString = process.env.MIGRATION_DATABASE_URL;
  if (!connectionString) {
    throw new Error("MIGRATION_DATABASE_URL is not set");
  }
  const pool = new pg.Pool({ connectionString, max: 1 });
  try {
    const created = await seed(pool);
    process.stdout.write(created ? "demo data created\n" : "demo data already present\n");
  } finally {
    await pool.end();
  }
}

if (import.meta.main) {
  main().catch((error: unknown) => {
    process.stderr.write(
      `seed failed: ${error instanceof Error ? error.message : String(error)}\n`,
    );
    process.exit(1);
  });
}
