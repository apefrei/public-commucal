-- Privileges of the auth role (ADR-0003, ADR-0004). Hand-written: drizzle-kit does not manage grants.
-- Better Auth reads and writes its own tables, reads tenants to resolve memberships, and appends to the audit log.
GRANT SELECT, INSERT, UPDATE, DELETE
  ON app_user, auth_session, auth_account, auth_verification, two_factor, tenant_member, tenant_invitation
  TO commucal_auth;
--> statement-breakpoint
GRANT SELECT ON tenant TO commucal_auth;
--> statement-breakpoint
GRANT INSERT ON audit_log TO commucal_auth;
