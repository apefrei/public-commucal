CREATE TABLE "calendar" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7(),
	"tenant_id" uuid NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"color" text,
	"is_public" boolean DEFAULT false NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "calendar_tenant_slug_unique" UNIQUE("tenant_id","slug"),
	CONSTRAINT "calendar_id_tenant_unique" UNIQUE("id","tenant_id"),
	CONSTRAINT "calendar_slug_format_check" CHECK ("slug" ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
	CONSTRAINT "calendar_color_check" CHECK ("color" is null or "color" ~ '^#[0-9a-f]{6}$')
);
--> statement-breakpoint
ALTER TABLE "calendar" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "event" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7(),
	"tenant_id" uuid NOT NULL,
	"calendar_id" uuid NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"location" text,
	"url" text,
	"all_day" boolean DEFAULT false NOT NULL,
	"starts_at" timestamp with time zone,
	"ends_at" timestamp with time zone,
	"start_date" date,
	"end_date" date,
	"time_zone" text DEFAULT 'Europe/Zurich' NOT NULL,
	"rrule" text,
	"exdates" date[] DEFAULT '{}'::date[] NOT NULL,
	"status" text DEFAULT 'confirmed' NOT NULL,
	"sequence" integer DEFAULT 0 NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "event_id_tenant_unique" UNIQUE("id","tenant_id"),
	CONSTRAINT "event_status_check" CHECK ("status" in ('confirmed', 'cancelled')),
	CONSTRAINT "event_time_shape_check" CHECK (("all_day" and "start_date" is not null and "starts_at" is null and "ends_at" is null
        and ("end_date" is null or "end_date" >= "start_date"))
      or (not "all_day" and "starts_at" is not null and "start_date" is null and "end_date" is null
        and ("ends_at" is null or "ends_at" >= "starts_at"))),
	CONSTRAINT "event_rrule_check" CHECK ("rrule" is null or "rrule" ~ '^FREQ=(DAILY|WEEKLY|MONTHLY|YEARLY)(;|$)')
);
--> statement-breakpoint
ALTER TABLE "event" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "event_translation" (
	"event_id" uuid,
	"tenant_id" uuid NOT NULL,
	"locale" text,
	"title" text NOT NULL,
	"description" text,
	"location" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "event_translation_pk" PRIMARY KEY("event_id","locale"),
	CONSTRAINT "event_translation_locale_check" CHECK (locale in ('de', 'fr', 'it'))
);
--> statement-breakpoint
ALTER TABLE "event_translation" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "tenant" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7(),
	"slug" text NOT NULL UNIQUE,
	"name" text NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"default_language" text DEFAULT 'de' NOT NULL,
	"enabled_languages" text[] DEFAULT '{de}'::text[] NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "tenant_status_check" CHECK ("status" in ('active', 'disabled')),
	CONSTRAINT "tenant_default_language_check" CHECK (default_language in ('de', 'fr', 'it')),
	CONSTRAINT "tenant_enabled_languages_check" CHECK ("enabled_languages" <@ array['de', 'fr', 'it']::text[] and "default_language" = any("enabled_languages")),
	CONSTRAINT "tenant_slug_format_check" CHECK ("slug" ~ '^[a-z0-9]+(-[a-z0-9]+)*$')
);
--> statement-breakpoint
ALTER TABLE "tenant" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE INDEX "event_calendar_starts_at_idx" ON "event" ("calendar_id","starts_at");--> statement-breakpoint
CREATE INDEX "event_calendar_start_date_idx" ON "event" ("calendar_id","start_date");--> statement-breakpoint
ALTER TABLE "calendar" ADD CONSTRAINT "calendar_tenant_id_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "event" ADD CONSTRAINT "event_calendar_same_tenant_fk" FOREIGN KEY ("calendar_id","tenant_id") REFERENCES "calendar"("id","tenant_id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "event_translation" ADD CONSTRAINT "event_translation_event_same_tenant_fk" FOREIGN KEY ("event_id","tenant_id") REFERENCES "event"("id","tenant_id") ON DELETE CASCADE;--> statement-breakpoint
CREATE VIEW "public_calendar" WITH (security_barrier = true) AS (select "calendar"."id", "calendar"."tenant_id", "tenant"."slug" as "tenant_slug", "calendar"."slug", "calendar"."name", "calendar"."description", "calendar"."color", "calendar"."sort_order", "calendar"."updated_at" from "calendar" inner join "tenant" on "tenant"."id" = "calendar"."tenant_id" where (("tenant"."status" = 'active') and ("calendar"."is_public" = true) and (("calendar"."deleted_at" is null))));--> statement-breakpoint
CREATE VIEW "public_event" WITH (security_barrier = true) AS (select "event"."id", "event"."tenant_id", "event"."calendar_id", "event"."title", "event"."description", "event"."location", "event"."url", "event"."all_day", "event"."starts_at", "event"."ends_at", "event"."start_date", "event"."end_date", "event"."time_zone", "event"."rrule", "event"."exdates", "event"."status", "event"."sequence", "event"."updated_at" from "event" inner join "calendar" on "calendar"."id" = "event"."calendar_id" inner join "tenant" on "tenant"."id" = "event"."tenant_id" where (("tenant"."status" = 'active') and ("calendar"."is_public" = true) and (("calendar"."deleted_at" is null)) and (("event"."deleted_at" is null))));--> statement-breakpoint
CREATE VIEW "public_event_translation" WITH (security_barrier = true) AS (select "event_translation"."event_id", "event_translation"."locale", "event_translation"."title", "event_translation"."description", "event_translation"."location" from "event_translation" inner join "event" on "event"."id" = "event_translation"."event_id" inner join "calendar" on "calendar"."id" = "event"."calendar_id" inner join "tenant" on "tenant"."id" = "event"."tenant_id" where (("tenant"."status" = 'active') and ("calendar"."is_public" = true) and (("calendar"."deleted_at" is null)) and (("event"."deleted_at" is null))));--> statement-breakpoint
CREATE VIEW "public_tenant" WITH (security_barrier = true) AS (select "id", "slug", "name", "default_language", "enabled_languages" from "tenant" where "tenant"."status" = 'active');--> statement-breakpoint
CREATE POLICY "calendar_tenant_isolation" ON "calendar" AS PERMISSIVE FOR ALL TO "commucal_app", "commucal_worker" USING ("calendar"."tenant_id" = commucal_current_tenant() or commucal_is_global_admin()) WITH CHECK ("calendar"."tenant_id" = commucal_current_tenant() or commucal_is_global_admin());--> statement-breakpoint
CREATE POLICY "event_tenant_isolation" ON "event" AS PERMISSIVE FOR ALL TO "commucal_app", "commucal_worker" USING ("event"."tenant_id" = commucal_current_tenant() or commucal_is_global_admin()) WITH CHECK ("event"."tenant_id" = commucal_current_tenant() or commucal_is_global_admin());--> statement-breakpoint
CREATE POLICY "event_translation_tenant_isolation" ON "event_translation" AS PERMISSIVE FOR ALL TO "commucal_app", "commucal_worker" USING ("event_translation"."tenant_id" = commucal_current_tenant() or commucal_is_global_admin()) WITH CHECK ("event_translation"."tenant_id" = commucal_current_tenant() or commucal_is_global_admin());--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "tenant" AS PERMISSIVE FOR ALL TO "commucal_app", "commucal_worker" USING ("tenant"."id" = commucal_current_tenant() or commucal_is_global_admin()) WITH CHECK ("tenant"."id" = commucal_current_tenant() or commucal_is_global_admin());