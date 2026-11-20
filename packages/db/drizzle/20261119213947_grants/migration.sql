-- Privileges of the runtime roles (ADR-0004). Hand-written: drizzle-kit does not manage grants.
-- App and worker work on tenant tables under row-level security; the MCP reader sees only the public views.
-- None of them owns a table, so none can alter the schema or bypass row-level security.

GRANT USAGE ON SCHEMA public TO commucal_app, commucal_worker, commucal_mcp;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON tenant, calendar, event, event_translation
  TO commucal_app, commucal_worker;
--> statement-breakpoint
GRANT SELECT ON public_tenant, public_calendar, public_event, public_event_translation
  TO commucal_app, commucal_worker, commucal_mcp;
