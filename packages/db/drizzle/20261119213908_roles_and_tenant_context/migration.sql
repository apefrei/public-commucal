-- Runtime roles and tenant context (ADR-0004). Hand-written: drizzle-kit does not manage roles or functions.
-- Roles are created without password and without LOGIN; the migrate container enables LOGIN and sets the
-- passwords from its environment, so no secret is stored in a migration.

DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'commucal_app') THEN
    CREATE ROLE commucal_app NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS;
  END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'commucal_worker') THEN
    CREATE ROLE commucal_worker NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS;
  END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'commucal_mcp') THEN
    CREATE ROLE commucal_mcp NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS;
  END IF;
END
$$;
--> statement-breakpoint

-- Tenant context of the current transaction, set by withTenant() with set_config(..., true).
-- An invalid value raises an error instead of matching nothing silently.
CREATE OR REPLACE FUNCTION commucal_current_tenant() RETURNS uuid
  LANGUAGE sql STABLE PARALLEL SAFE
  AS $$ SELECT nullif(current_setting('app.tenant_id', true), '')::uuid $$;
--> statement-breakpoint

CREATE OR REPLACE FUNCTION commucal_is_global_admin() RETURNS boolean
  LANGUAGE sql STABLE PARALLEL SAFE
  AS $$ SELECT coalesce(current_setting('app.is_global_admin', true), '') = 'on' $$;
--> statement-breakpoint

-- Nobody but the owner creates objects in the public schema.
REVOKE CREATE ON SCHEMA public FROM PUBLIC;
