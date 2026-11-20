# ADR 0004: Data layer – Drizzle, row-level security and append-only audit log

- Status: Accepted
- Date: 2026-11-19
- Authors: apefrei

## Context

Tenant data must be strictly separated (G3, NFR-3). The audit log must be immutable (FR-41); the previous plan only
made it read-only in the UI. The MCP server must only ever see public data (FR-48). The playbook allows Drizzle or
Prisma.

## Decision

Use PostgreSQL 18 with Drizzle ORM. Enforce tenant isolation and access limits in the database with roles and
row-level security (RLS), in addition to the application's authorisation checks. Make the audit log append-only
and tamper-evident with a hash chain.

### Database roles

| Role | Used by | Rights |
|---|---|---|
| `commucal_owner` | `migrate` | Owns schema; runs migrations; never used at runtime |
| `commucal_app` | `web` | DML on tenant tables under RLS; `INSERT`/`SELECT` only on `audit_log` |
| `commucal_worker` | `worker` | Like `commucal_app`, plus the specific cross-tenant jobs (anonymisation, purge) via `SECURITY DEFINER` functions |
| `commucal_mcp` | `mcp` | `SELECT` on the `public_*` views only; no access to base tables |
| `commucal_auth` | Better Auth in `web`, `admin` CLI | DML on the auth tables (users, sessions, credentials, TOTP, memberships, invitations); `SELECT` on `tenant`; `INSERT` only on `audit_log` (ADR-0003, added in WP-1.4) |

No runtime role has `BYPASSRLS` or owns tables.

### Tenant isolation

- Every tenant-owned table has `tenant_id` and an RLS policy
  `tenant_id = current_setting('app.tenant_id')::uuid`, with a separate policy for global admins
  (`current_setting('app.is_global_admin', true) = 'on'`).
- The application sets these values with `SET LOCAL` inside the transaction of each request, so pooled connections
  never carry another request's tenant.
- Integration tests run every API route and server action as tenant A against tenant B data and expect denial.

### Public views for MCP and feeds

- `public_tenants`, `public_calendars`, `public_events` (and translations) expose only active tenants, public calendars
  and non-deleted events, without internal columns.

### Audit log

- `audit_log` rows: id, tenant_id (null for platform actions), chain_seq, actor_user_id or actor_label, action,
  entity type and id, data (jsonb, no secrets), created_at, prev_hash, hash.
- Runtime roles have only `INSERT` and `SELECT` (`commucal_auth`: `INSERT` only); triggers additionally reject `UPDATE`, `DELETE` and `TRUNCATE` for
  everyone, including the owner.
- A `SECURITY DEFINER` insert trigger takes a per-chain advisory lock, numbers the entry (`chain_seq`), links
  `prev_hash` and computes `hash = sha256(prev_hash || canonical row)`. Values for these columns and for
  `created_at` supplied by the caller are ignored. Ordering uses `chain_seq`, not `id`, because ids are assigned
  before the lock; time enters the hash as microseconds since the epoch, so it does not depend on the session time zone.
- `commucal_verify_audit_chain(tenant_id)` (executable by the worker only) returns the first broken entry; the
  worker runs it daily (FR-43).
- Limits: a superuser can disable the triggers. Changed or removed entries inside a chain are then detected, removing
  the newest entries is not; anchoring chain heads outside the database can be added later if needed.
- When a user is deleted, audit rows keep the user id; the display name is shown as "deleted user".

### Other schema rules

- Times stored as `timestamptz` (UTC); all-day events as `date`; recurrence as RRULE/EXDATE text plus the tenant
  time zone.
- Event content translations in a separate table keyed by event and language (FR-23).
- Soft delete with `deleted_at` for calendars and events; purge after 30 days by the worker.

## Rationale

- Drizzle defines RLS policies and roles in the schema code, keeps SQL visible and works with Better Auth's adapter.
- Database-level enforcement means a bug in one route cannot leak another tenant's data or alter the audit log.
- A separate role with only views for MCP makes its read-only, public-only promise a database fact.

## Rejected alternatives

- **Prisma:** RLS needs workarounds (interactive transactions per request, extensions); policies live outside the schema.
- **Application-only isolation:** one missing `where tenant_id` leaks data.
- **Schema or database per tenant:** strong isolation but heavy migrations and operations for hundreds of small tenants.
- **External audit store (e.g. append-only object storage):** more services; hash chain in PostgreSQL is enough to
  detect tampering at this scale.

## Consequences

- Positive: defence in depth; tamper-evident audit log; MCP cannot see private data even if compromised.
- Negative: every query path must run inside a transaction that sets the tenant context; enforced by a single data
  access helper and tests.
- Negative: RLS policies add some query overhead; covered by indexes on `tenant_id`.
- Follow-up: WP-1.3; ⚠️ migrations are high risk per `.claude/rules/policies.md`.

## References

- [`docs/requirements.md`](../requirements.md) NFR-3, FR-40 to FR-43, FR-48
- ADR-0003 (auth), ADR-0005 (MCP server)
