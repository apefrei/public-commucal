# ADR 0003: Authentication with Better Auth and mandatory MFA

- Status: Accepted
- Date: 2026-11-19
- Authors: apefrei

## Context

Backend users manage public information of municipalities. The requirements make MFA mandatory for every backend
account (FR-3). The previous plan (Task Master, April 2026) used Auth.js v5 with TOTP that was only checked
"when a TOTP secret exists" and offered a "disable MFA" button – contradicting the requirement.

Further needs: multi-tenancy with a role per tenant, invitations, global admins, password reset, backup codes.
The playbook forbids building auth ourselves and allows Auth.js or Better Auth.

## Decision

Use Better Auth with its `twoFactor` (TOTP and backup codes), `organization` (tenants, members, roles, invitations)
and `admin` (global admin role) plugins and the Drizzle adapter. MFA is enforced by the application: any session of a
user without a verified TOTP factor is restricted to the MFA setup flow.

Rules:

- A tenant is a Better Auth organisation. Roles per membership: `admin`, `contributor`. Global admins carry the
  user-level role `global_admin`.
- After password login, a user without a verified TOTP factor is redirected to MFA setup. Middleware and every
  server-side authorisation check reject such sessions for all other routes and actions.
- Users cannot disable MFA. Tenant admins (own tenant) and global admins can reset it; the reset is audit-logged,
  the user is notified by email and must set up MFA again at next login.
- Backup codes are generated at setup and stored hashed.
- Password policy: at least 12 characters plus a breached-password check; no composition rules.
- Sessions: HttpOnly, Secure, SameSite=Lax cookies; origin checks for state-changing requests.
- The first global admin is created by a CLI command in the container.

## Rationale

- Better Auth covers organisations, roles, invitations, TOTP and backup codes as maintained plugins, so none of this
  is custom code.
- Auth.js is now maintained under the Better Auth project; starting new work on Better Auth avoids a later migration.
- Enforcement in our own middleware and authorisation layer makes "MFA mandatory" a testable rule instead of a UI option.

## Rejected alternatives

- **Auth.js v5:** long beta, no built-in organisations or TOTP; more custom code around it.
- **Hosted identity (Clerk, Auth0, Supabase Auth):** an additional processor holding backend users' data outside our
  hosting; recurring cost; less control over the MFA policy.
- **Passkeys only:** attractive, but municipal staff often share or change devices. Passkeys may be added later as an
  additional second factor.

## Consequences

- Positive: mandatory MFA is enforced on the server and covered by tests; standard, maintained auth code.
- Negative: dependency on Better Auth's release pace and schema; pinned versions and upgrade PRs with full tests.
- Follow-up: WP-1.4; E2E tests proving that a user without MFA cannot reach any backend route or action.
- ⚠️ Security-relevant: changes to this flow are high risk per `.claude/rules/policies.md`.

## References

- [`docs/requirements.md`](../requirements.md) FR-1 to FR-9, section 3
- ADR-0004 (tenant context in the database), ADR-0006 (email)
- Auth.js README (nextauthjs/next-auth, checked 2026-11-19): "Auth js is now part of Better Auth. We recommend new
  projects to start with Better Auth"; Auth.js v5 is still published as `5.0.0-beta.32`.
