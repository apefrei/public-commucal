-- Auth role (ADR-0003, ADR-0004). Hand-written: drizzle-kit does not manage roles.
-- Only Better Auth connects with commucal_auth. It owns users, sessions, credentials, TOTP factors, memberships and
-- invitations, and may read tenants. App, worker and MCP get no privileges on these tables, and commucal_auth gets
-- none on calendars or events. Same race-safe creation as in the first migration.
DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'commucal_auth') THEN
    BEGIN
      CREATE ROLE commucal_auth NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS;
    EXCEPTION
      WHEN duplicate_object OR unique_violation THEN NULL;
    END;
  END IF;
END
$$;
--> statement-breakpoint
GRANT USAGE ON SCHEMA public TO commucal_auth;
