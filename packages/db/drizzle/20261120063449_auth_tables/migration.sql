CREATE TABLE "app_user" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7(),
	"name" text NOT NULL,
	"email" text NOT NULL UNIQUE,
	"email_verified" boolean DEFAULT false NOT NULL,
	"image" text,
	"two_factor_enabled" boolean DEFAULT false NOT NULL,
	"two_factor_enabled_at" timestamp with time zone,
	"global_admin" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "app_user_email_lower_check" CHECK ("email" = lower("email"))
);
--> statement-breakpoint
ALTER TABLE "app_user" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "auth_account" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7(),
	"account_id" text NOT NULL,
	"provider_id" text NOT NULL,
	"user_id" uuid NOT NULL,
	"access_token" text,
	"refresh_token" text,
	"id_token" text,
	"access_token_expires_at" timestamp with time zone,
	"refresh_token_expires_at" timestamp with time zone,
	"scope" text,
	"password" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "auth_account_provider_unique" UNIQUE("provider_id","account_id")
);
--> statement-breakpoint
ALTER TABLE "auth_account" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "auth_session" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7(),
	"expires_at" timestamp with time zone NOT NULL,
	"token" text NOT NULL UNIQUE,
	"ip_address" text,
	"user_agent" text,
	"user_id" uuid NOT NULL,
	"active_tenant_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "auth_session" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "auth_verification" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7(),
	"identifier" text NOT NULL,
	"value" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "auth_verification" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "tenant_invitation" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7(),
	"tenant_id" uuid NOT NULL,
	"email" text NOT NULL,
	"role" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"inviter_id" uuid NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "tenant_invitation_role_check" CHECK ("role" in ('admin', 'contributor')),
	CONSTRAINT "tenant_invitation_status_check" CHECK ("status" in ('pending', 'accepted', 'rejected', 'canceled'))
);
--> statement-breakpoint
ALTER TABLE "tenant_invitation" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "tenant_member" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7(),
	"tenant_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"role" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "tenant_member_unique" UNIQUE("tenant_id","user_id"),
	CONSTRAINT "tenant_member_role_check" CHECK ("role" in ('admin', 'contributor'))
);
--> statement-breakpoint
ALTER TABLE "tenant_member" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "two_factor" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7(),
	"secret" text NOT NULL,
	"backup_codes" text NOT NULL,
	"user_id" uuid NOT NULL UNIQUE,
	"verified" boolean DEFAULT true NOT NULL,
	"failed_verification_count" integer DEFAULT 0 NOT NULL,
	"locked_until" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "two_factor" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "tenant" ADD COLUMN "logo" text;--> statement-breakpoint
ALTER TABLE "tenant" ADD COLUMN "metadata" text;--> statement-breakpoint
CREATE INDEX "auth_account_user_idx" ON "auth_account" ("user_id");--> statement-breakpoint
CREATE INDEX "auth_session_user_idx" ON "auth_session" ("user_id");--> statement-breakpoint
CREATE INDEX "auth_verification_identifier_idx" ON "auth_verification" ("identifier");--> statement-breakpoint
CREATE INDEX "tenant_invitation_tenant_idx" ON "tenant_invitation" ("tenant_id");--> statement-breakpoint
CREATE INDEX "tenant_invitation_email_idx" ON "tenant_invitation" ("email");--> statement-breakpoint
CREATE INDEX "tenant_member_user_idx" ON "tenant_member" ("user_id");--> statement-breakpoint
ALTER TABLE "auth_account" ADD CONSTRAINT "auth_account_user_id_app_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "app_user"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "auth_session" ADD CONSTRAINT "auth_session_user_id_app_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "app_user"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "auth_session" ADD CONSTRAINT "auth_session_active_tenant_id_tenant_id_fkey" FOREIGN KEY ("active_tenant_id") REFERENCES "tenant"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "tenant_invitation" ADD CONSTRAINT "tenant_invitation_tenant_id_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "tenant_invitation" ADD CONSTRAINT "tenant_invitation_inviter_id_app_user_id_fkey" FOREIGN KEY ("inviter_id") REFERENCES "app_user"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "tenant_member" ADD CONSTRAINT "tenant_member_tenant_id_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "tenant_member" ADD CONSTRAINT "tenant_member_user_id_app_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "app_user"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "two_factor" ADD CONSTRAINT "two_factor_user_id_app_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "app_user"("id") ON DELETE CASCADE;--> statement-breakpoint
CREATE POLICY "app_user_auth" ON "app_user" AS PERMISSIVE FOR ALL TO "commucal_auth" USING (true) WITH CHECK (true);--> statement-breakpoint
CREATE POLICY "auth_account_auth" ON "auth_account" AS PERMISSIVE FOR ALL TO "commucal_auth" USING (true) WITH CHECK (true);--> statement-breakpoint
CREATE POLICY "auth_session_auth" ON "auth_session" AS PERMISSIVE FOR ALL TO "commucal_auth" USING (true) WITH CHECK (true);--> statement-breakpoint
CREATE POLICY "auth_verification_auth" ON "auth_verification" AS PERMISSIVE FOR ALL TO "commucal_auth" USING (true) WITH CHECK (true);--> statement-breakpoint
CREATE POLICY "tenant_auth_read" ON "tenant" AS PERMISSIVE FOR SELECT TO "commucal_auth" USING (true);--> statement-breakpoint
CREATE POLICY "tenant_invitation_auth" ON "tenant_invitation" AS PERMISSIVE FOR ALL TO "commucal_auth" USING (true) WITH CHECK (true);--> statement-breakpoint
CREATE POLICY "tenant_member_auth" ON "tenant_member" AS PERMISSIVE FOR ALL TO "commucal_auth" USING (true) WITH CHECK (true);--> statement-breakpoint
CREATE POLICY "two_factor_auth" ON "two_factor" AS PERMISSIVE FOR ALL TO "commucal_auth" USING (true) WITH CHECK (true);--> statement-breakpoint
ALTER POLICY "audit_log_append" ON "audit_log" TO "commucal_app", "commucal_auth", "commucal_worker" WITH CHECK ("audit_log"."tenant_id" is null or "audit_log"."tenant_id" = commucal_current_tenant() or commucal_is_global_admin());