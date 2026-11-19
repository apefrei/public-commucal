import { and, eq, isNull, sql } from "drizzle-orm";
import { pgView } from "drizzle-orm/pg-core";
import { calendar, event, eventTranslation, tenant } from "./tables.ts";

// Public data for feeds, public pages and the MCP server (ADR-0004, ADR-0005). The views run with the owner's
// rights, so they see all tenants, and expose only active tenants, public calendars and non-deleted events.
// security_barrier keeps user-supplied filters from being evaluated before the view's own conditions.

export const publicTenant = pgView("public_tenant")
  .with({ securityBarrier: true })
  .as((qb) =>
    qb
      .select({
        id: tenant.id,
        slug: tenant.slug,
        name: tenant.name,
        defaultLanguage: tenant.defaultLanguage,
        enabledLanguages: tenant.enabledLanguages,
      })
      .from(tenant)
      .where(eq(tenant.status, "active")),
  );

export const publicCalendar = pgView("public_calendar")
  .with({ securityBarrier: true })
  .as((qb) =>
    qb
      .select({
        id: calendar.id,
        tenantId: calendar.tenantId,
        // Aliased explicitly: calendar.slug and tenant.slug would otherwise both be named "slug".
        tenantSlug: sql<string>`${tenant.slug}`.as("tenant_slug"),
        slug: calendar.slug,
        name: calendar.name,
        description: calendar.description,
        color: calendar.color,
        sortOrder: calendar.sortOrder,
        updatedAt: calendar.updatedAt,
      })
      .from(calendar)
      .innerJoin(tenant, eq(tenant.id, calendar.tenantId))
      .where(
        and(eq(tenant.status, "active"), eq(calendar.isPublic, true), isNull(calendar.deletedAt)),
      ),
  );

export const publicEvent = pgView("public_event")
  .with({ securityBarrier: true })
  .as((qb) =>
    qb
      .select({
        id: event.id,
        tenantId: event.tenantId,
        calendarId: event.calendarId,
        title: event.title,
        description: event.description,
        location: event.location,
        url: event.url,
        allDay: event.allDay,
        startsAt: event.startsAt,
        endsAt: event.endsAt,
        startDate: event.startDate,
        endDate: event.endDate,
        timeZone: event.timeZone,
        rrule: event.rrule,
        exdates: event.exdates,
        status: event.status,
        sequence: event.sequence,
        updatedAt: event.updatedAt,
      })
      .from(event)
      .innerJoin(calendar, eq(calendar.id, event.calendarId))
      .innerJoin(tenant, eq(tenant.id, event.tenantId))
      .where(
        and(
          eq(tenant.status, "active"),
          eq(calendar.isPublic, true),
          isNull(calendar.deletedAt),
          isNull(event.deletedAt),
        ),
      ),
  );

export const publicEventTranslation = pgView("public_event_translation")
  .with({ securityBarrier: true })
  .as((qb) =>
    qb
      .select({
        eventId: eventTranslation.eventId,
        locale: eventTranslation.locale,
        title: eventTranslation.title,
        description: eventTranslation.description,
        location: eventTranslation.location,
      })
      .from(eventTranslation)
      .innerJoin(event, eq(event.id, eventTranslation.eventId))
      .innerJoin(calendar, eq(calendar.id, event.calendarId))
      .innerJoin(tenant, eq(tenant.id, event.tenantId))
      .where(
        and(
          eq(tenant.status, "active"),
          eq(calendar.isPublic, true),
          isNull(calendar.deletedAt),
          isNull(event.deletedAt),
        ),
      ),
  );
