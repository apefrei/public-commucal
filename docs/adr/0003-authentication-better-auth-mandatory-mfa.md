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
and `haveIBeenPwned` plugins and the Drizzle adapter. MFA is enforced by the application: any session that is not
MFA-verified is restricted to the MFA setup flow.

Rules:

- A tenant is a Better Auth organisation (our `tenant` table). Roles per membership: `admin`, `contributor`.
  Global admins carry the user flag `global_admin`, which no API accepts as input. The `admin` plugin is not used:
  it would add user management endpoints (impersonation, role changes) we do not need.
- After password login, a user without a verified TOTP factor is redirected to MFA setup. Middleware and every
  server-side authorisation check reject such sessions for all other routes and actions.
- Users cannot disable MFA. Tenant admins (own tenant) and global admins can reset it; the reset is audit-logged,
  the user is notified by email and must set up MFA again at next login.
- Backup codes are generated at setup and stored hashed.
- Password policy: at least 12 characters plus a breached-password check; no composition rules.
- Sessions: HttpOnly, Secure, SameSite=Lax cookies; origin checks for state-changing requests.
- The first global admin is created by a CLI command in the container.

### Implementation rules (WP-1.4, Better Auth 1.7.26)

- **Own database role.** Better Auth connects as `commucal_auth`. Only this role can read users, sessions,
  credentials, TOTP factors, memberships and invitations; it can read tenants (membership lookup before any tenant
  context exists) and append to the audit log, but not read calendars, events or the audit log. App, worker and MCP
  get no privileges on the auth tables. Row-level security on the auth tables admits only `commucal_auth`, so a
  grant added by mistake still returns no rows.
- **MFA-verified session:** the user has a verified TOTP factor (`two_factor_enabled`) and the session was created
  at or after `two_factor_enabled_at`. Better Auth replaces the session when TOTP is verified at setup and creates
  a login session only after the TOTP step; the timestamp also excludes sessions opened in another browser before
  MFA setup.
- **Closed paths** (HTTP 404, list in `packages/auth/src/auth.ts`): public sign-up, disabling MFA, email OTP (it
  would mark MFA as enabled without verifying a code), creating, changing, deleting and leaving tenants.
  "Trust this device" is rejected, so TOTP is required at every login.
- **Better Auth's own endpoints** follow the same rule: a `before` hook rejects every request with a session that
  is not MFA-verified, except login, logout, session lookup, TOTP setup and password reset. Member and invitation
  changes in a disabled tenant are rejected by organisation hooks.
- **Accounts** are created only through an invitation or the CLI, both server-side. The registration form of an
  invitation takes the email from the invitation, never from the form, and marks it verified.
- **Invitations** are created by CommuCal code (`inviteToTenant`), not by Better Auth's endpoint, which requires the
  inviter to be a member and so excludes global admins. Tenant admins invite to their tenant, global admins to any
  active tenant; every invitation and acceptance is audited. The invitation id is the secret in the link and is a
  random UUIDv4. Accepting stays with Better Auth (email must match) and needs an MFA-verified session.
- **Rate limits** are CommuCal's (ADR-0007, Valkey); Better Auth's per-process limiter is off because its fixed
  3 logins per 10 s and IP blocks an office whose staff share one IP.
- **Backup codes and TOTP secrets** are stored encrypted with `BETTER_AUTH_SECRET`, not hashed: Better Auth
  verifies a backup code by decrypting the stored list (`plugins/two-factor/backup-codes/index.mjs`), and hashing
  would mean our own crypto code. Consequence: changing `BETTER_AUTH_SECRET` invalidates every user's MFA.
- **Breached passwords:** Have I Been Pwned range API (k-anonymity, only five hash characters leave the server).
  If the service is unreachable, setting a password fails (fail closed).
- **Sessions** last 8 hours and are read from the database on every request (no cookie cache), so a revoked
  session or a reset MFA takes effect immediately. A password reset ends all sessions and keeps MFA.
- **MFA reset** (`resetMfa`): global admins for anyone; tenant admins for members of their tenant who are not
  global admins; nobody for themselves. Factor removal, session revocation and audit entry share one transaction.
- **Known limitation:** Better Auth does not keep a record of used TOTP codes, so a code can be reused within its
  30-second window. Account lockout after 10 failed attempts (15 minutes) is Better Auth's default and stays on.

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

- Positive: mandatory MFA is enforced on the server and covered by tests; standard, maintained auth code;
  credentials and sessions are invisible to every role except `commucal_auth`.
- Negative: dependency on Better Auth's release pace and schema; pinned versions and upgrade PRs with full tests.
- Negative: `BETTER_AUTH_SECRET` must be kept and backed up like a key; losing or rotating it forces every user
  through an MFA reset.
- Follow-up: WP-1.4 part 2 (web integration, invitations, emails, rate limiting on Valkey); E2E tests proving that
  a user without MFA cannot reach any backend route or action.
- ⚠️ Security-relevant: changes to this flow are high risk per `.claude/rules/policies.md`.

## References

- [`docs/requirements.md`](../requirements.md) FR-1 to FR-9, section 3
- ADR-0004 (tenant context in the database), ADR-0006 (email)
- Auth.js README (nextauthjs/next-auth, checked 2026-11-19): "Auth js is now part of Better Auth. We recommend new
  projects to start with Better Auth"; Auth.js v5 is still published as `5.0.0-beta.32`.
