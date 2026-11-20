CREATE TABLE "audit_log" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "audit_log_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"tenant_id" uuid,
	"chain_seq" bigint DEFAULT 0 NOT NULL,
	"actor_user_id" uuid,
	"actor_label" text,
	"action" text NOT NULL,
	"entity_type" text,
	"entity_id" text,
	"data" jsonb DEFAULT '{}' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"prev_hash" bytea,
	"hash" bytea DEFAULT '\x' NOT NULL,
	CONSTRAINT "audit_log_chain_unique" UNIQUE NULLS NOT DISTINCT("tenant_id","chain_seq")
);
--> statement-breakpoint
ALTER TABLE "audit_log" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE INDEX "audit_log_tenant_created_idx" ON "audit_log" ("tenant_id","created_at");--> statement-breakpoint
CREATE POLICY "audit_log_read" ON "audit_log" AS PERMISSIVE FOR SELECT TO "commucal_app", "commucal_worker" USING ("audit_log"."tenant_id" = commucal_current_tenant() or commucal_is_global_admin());--> statement-breakpoint
CREATE POLICY "audit_log_append" ON "audit_log" AS PERMISSIVE FOR INSERT TO "commucal_app", "commucal_worker" WITH CHECK ("audit_log"."tenant_id" is null or "audit_log"."tenant_id" = commucal_current_tenant() or commucal_is_global_admin());