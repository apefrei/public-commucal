-- Runtime roles and tenant context (ADR-0004). Hand-written: drizzle-kit does not manage roles or functions.
-- Roles are created without password and without LOGIN; the migrate container enables LOGIN and sets the
-- passwords from its environment, so no secret is stored in a migration.

-- Roles exist once per cluster, while every database runs this migration. Two migrations running at the same time
-- (e.g. parallel integration tests) may both see a role as missing; the second CREATE ROLE then fails and is ignored.
DO $$
DECLARE
  role_name text;
BEGIN
  FOREACH role_name IN ARRAY ARRAY['commucal_app', 'commucal_worker', 'commucal_mcp'] LOOP
    IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = role_name) THEN
      BEGIN
        EXECUTE format(
          'CREATE ROLE %I NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS', role_name
        );
      EXCEPTION
        WHEN duplicate_object OR unique_violation THEN NULL;
      END;
    END IF;
  END LOOP;
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
