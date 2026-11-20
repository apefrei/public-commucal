import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  date,
  foreignKey,
  index,
  integer,
  pgPolicy,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";
import { authRole } from "./roles.ts";
import { tenantIsolationPolicy } from "./tenancy.ts";

const id = () => uuid("id").primaryKey().default(sql`uuidv7()`);
const createdAt = () => timestamp("created_at", { withTimezone: true }).notNull().defaultNow();
const updatedAt = () => timestamp("updated_at", { withTimezone: true }).notNull().defaultNow();
const deletedAt = () => timestamp("deleted_at", { withTimezone: true });
const localeCheck = (column: string) => sql.raw(`${column} in ('de', 'fr', 'it')`);

/**
 * A municipality or association (requirements FR-1). Also the Better Auth organisation (ADR-0003).
 */
export const tenant = pgTable.withRLS(
  "tenant",
  {
    id: id(),
    slug: text("slug").notNull().unique(),
    name: text("name").notNull(),
    status: text("status").notNull().default("active"),
    defaultLanguage: text("default_language").notNull().default("de"),
    enabledLanguages: text("enabled_languages").array().notNull().default(sql`'{de}'::text[]`),
    /** Better Auth organisation fields (ADR-0003); unused by CommuCal so far. */
    logo: text("logo"),
    metadata: text("metadata"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    check("tenant_status_check", sql`${t.status} in ('active', 'disabled')`),
    check("tenant_default_language_check", localeCheck("default_language")),
    check(
      "tenant_enabled_languages_check",
      sql`${t.enabledLanguages} <@ array['de', 'fr', 'it']::text[] and ${t.defaultLanguage} = any(${t.enabledLanguages})`,
    ),
    check("tenant_slug_format_check", sql`${t.slug} ~ '^[a-z0-9]+(-[a-z0-9]+)*$'`),
    tenantIsolationPolicy("tenant_isolation", t.id),
    // Better Auth resolves memberships before any tenant context exists. It may only read tenants; creating,
    // renaming and disabling them stays with the app under the global-admin context (FR-1).
    pgPolicy("tenant_auth_read", {
      as: "permissive",
      for: "select",
      to: authRole,
      using: sql`true`,
    }),
  ],
);

/** A calendar of a tenant (requirements FR-10). */
export const calendar = pgTable.withRLS(
  "calendar",
  {
    id: id(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenant.id, { onDelete: "cascade" }),
    slug: text("slug").notNull(),
    name: text("name").notNull(),
    description: text("description"),
    color: text("color"),
    isPublic: boolean("is_public").notNull().default(false),
    sortOrder: integer("sort_order").notNull().default(0),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    deletedAt: deletedAt(),
  },
  (t) => [
    unique("calendar_tenant_slug_unique").on(t.tenantId, t.slug),
    // Target of the composite foreign key from event: an event can only belong to a calendar of its own tenant.
    unique("calendar_id_tenant_unique").on(t.id, t.tenantId),
    check("calendar_slug_format_check", sql`${t.slug} ~ '^[a-z0-9]+(-[a-z0-9]+)*$'`),
    check("calendar_color_check", sql`${t.color} is null or ${t.color} ~ '^#[0-9a-f]{6}$'`),
    tenantIsolationPolicy("calendar_tenant_isolation", t.tenantId),
  ],
);

/**
 * An event (requirements FR-11). Timed events use instants (UTC) plus the tenant time zone for recurrence;
 * all-day events use dates. Text columns hold the tenant's default language; other languages are in
 * event_translation (FR-23).
 */
export const event = pgTable.withRLS(
  "event",
  {
    id: id(),
    tenantId: uuid("tenant_id").notNull(),
    calendarId: uuid("calendar_id").notNull(),
    title: text("title").notNull(),
    description: text("description"),
    location: text("location"),
    url: text("url"),
    allDay: boolean("all_day").notNull().default(false),
    startsAt: timestamp("starts_at", { withTimezone: true }),
    endsAt: timestamp("ends_at", { withTimezone: true }),
    startDate: date("start_date", { mode: "string" }),
    endDate: date("end_date", { mode: "string" }),
    timeZone: text("time_zone").notNull().default("Europe/Zurich"),
    rrule: text("rrule"),
    // Local dates of excluded occurrences; at most one occurrence per day is supported (FR-12).
    exdates: date("exdates", { mode: "string" }).array().notNull().default(sql`'{}'::date[]`),
    status: text("status").notNull().default("confirmed"),
    // iCal SEQUENCE, incremented on every change (FR-16).
    sequence: integer("sequence").notNull().default(0),
    createdBy: uuid("created_by"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    deletedAt: deletedAt(),
  },
  (t) => [
    foreignKey({
      name: "event_calendar_same_tenant_fk",
      columns: [t.calendarId, t.tenantId],
      foreignColumns: [calendar.id, calendar.tenantId],
    }).onDelete("cascade"),
    unique("event_id_tenant_unique").on(t.id, t.tenantId),
    index("event_calendar_starts_at_idx").on(t.calendarId, t.startsAt),
    index("event_calendar_start_date_idx").on(t.calendarId, t.startDate),
    check("event_status_check", sql`${t.status} in ('confirmed', 'cancelled')`),
    check(
      "event_time_shape_check",
      sql`(${t.allDay} and ${t.startDate} is not null and ${t.startsAt} is null and ${t.endsAt} is null
        and (${t.endDate} is null or ${t.endDate} >= ${t.startDate}))
      or (not ${t.allDay} and ${t.startsAt} is not null and ${t.startDate} is null and ${t.endDate} is null
        and (${t.endsAt} is null or ${t.endsAt} >= ${t.startsAt}))`,
    ),
    check(
      "event_rrule_check",
      sql`${t.rrule} is null or ${t.rrule} ~ '^FREQ=(DAILY|WEEKLY|MONTHLY|YEARLY)(;|$)'`,
    ),
    tenantIsolationPolicy("event_tenant_isolation", t.tenantId),
  ],
);

/** Event content in additional languages (requirements FR-23). */
export const eventTranslation = pgTable.withRLS(
  "event_translation",
  {
    eventId: uuid("event_id").notNull(),
    tenantId: uuid("tenant_id").notNull(),
    locale: text("locale").notNull(),
    title: text("title").notNull(),
    description: text("description"),
    location: text("location"),
    updatedAt: updatedAt(),
  },
  (t) => [
    primaryKey({ name: "event_translation_pk", columns: [t.eventId, t.locale] }),
    foreignKey({
      name: "event_translation_event_same_tenant_fk",
      columns: [t.eventId, t.tenantId],
      foreignColumns: [event.id, event.tenantId],
    }).onDelete("cascade"),
    check("event_translation_locale_check", localeCheck("locale")),
    tenantIsolationPolicy("event_translation_tenant_isolation", t.tenantId),
  ],
);
