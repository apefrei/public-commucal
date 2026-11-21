# Development

Everything runs in containers; the host needs only Docker with Compose v2.24 or newer. Architecture and
reasons: [ADR-0002](adr/0002-container-stack-and-deployment-topology.md),
[ADR-0009](adr/0009-toolchain-and-language-versions.md).

## Setup

```bash
cp .env.example .env
# set POSTGRES_PASSWORD (e.g. openssl rand -hex 24); on cyberfrog also COMMUCAL_HOST and PROXY_BIND
```

## Daily work: live sync

```bash
docker compose -f compose.yaml -f compose.dev.yaml --profile local up --watch
```

- Source changes are synced into the containers: Next.js reloads (HMR), `mcp` and `worker` restart via `node --watch`.
- A change to `pnpm-lock.yaml` rebuilds the dev image.
- App: `https://<COMMUCAL_HOST>:8443` (Caddy with its own local CA; accept the certificate warning or trust the
  root certificate from the `caddy_data` volume, `pki/authorities/local/root.crt`).
- Mail: the worker sends every email to Mailpit (profile `local`), web UI at `http://127.0.0.1:8025`.

## Checks

```bash
docker compose --profile test run --rm test   # Biome, typecheck, unit tests (same as CI)
```

## Database and migrations

Design: [ADR-0004](adr/0004-data-layer-drizzle-rls-append-only-audit.md). Schema in `packages/db/src/schema`,
migrations in `packages/db/drizzle` (one folder per migration).

- Change the schema, then generate a migration: `pnpm --filter @commucal/db db:generate --name <name>`
- Roles, functions, grants and triggers are not managed by drizzle-kit: create an empty migration with
  `pnpm --filter @commucal/db db:custom --name <name>` and write the SQL by hand.
- Grant every new table to the runtime roles in a custom migration and add it to the isolation tests.
- The `migrate` container applies all migrations before `web`, `mcp` and `worker` start and sets the runtime
  role passwords from `.env`.
- Every database access to tenant data runs inside `withTenant(db, { tenantId }, (tx) => …)`; outside it,
  row-level security returns no rows.

| Role | Used by | Can do |
|---|---|---|
| `commucal_owner` | `migrate`, tests | everything (superuser); never used by the running apps |
| `commucal_app` | `web` | read/write tenant tables of the current tenant (RLS), read public views |
| `commucal_worker` | `worker` | like `commucal_app` |
| `commucal_mcp` | `mcp` | read the `public_*` views only |
| `commucal_auth` | Better Auth in `web`, `admin` | users, sessions, credentials, TOTP factors, memberships, invitations; read tenants; append to the audit log ([ADR-0003](adr/0003-authentication-better-auth-mandatory-mfa.md)) |

No other role can read the auth tables, and `commucal_auth` cannot read calendars, events or the audit log.

Demo data (fictional municipality "Musterdorf", idempotent):

```bash
docker compose run --rm migrate node src/seed.ts
```

Audit entries are written with `recordAudit(tx, { tenantId, action, … })` inside the transaction of the change;
the database numbers, links and hashes them (append-only, see ADR-0004).

Integration tests (`packages/db`, `packages/auth`) create a throw-away database per run; they need
`TEST_DATABASE_URL` (set by the Compose profile `test` and in CI).

## Jobs and email

Background jobs run on pg-boss in PostgreSQL (schema `pgboss`). The `migrate` container installs the schema and the
queues as owner; `web` may only send jobs, the `worker` processes them. Emails (ADR-0006) are queued with
`enqueueEmail()` and sent by the worker as plain text: through Resend if `RESEND_API_KEY` is set, otherwise through
Mailpit (`MAILPIT_URL`). Without either the worker does not start.

## Authentication

Better Auth with mandatory TOTP ([ADR-0003](adr/0003-authentication-better-auth-mandatory-mfa.md)), configured in
`packages/auth`. Every backend page, route handler and server action calls `requireBackendUser()`; only the MFA
setup flow may accept a session that is not MFA-verified. Tenant permissions: `requireTenantRole()`.

Pages: `/anmelden` (login, then `/anmelden/code` for TOTP or a backup code), `/mfa-einrichten` (QR code, backup
codes, first code), `/passwort-vergessen`, `/passwort-zuruecksetzen`, `/backend`. Better Auth's endpoints are served
under `/api/auth` behind CommuCal's rate limits (`apps/web/src/server/rate-limit.ts`, Valkey, hashed keys); Better
Auth's own per-process limiter is off (its fixed 3 logins per 10 s and IP would block an office behind one IP). The web app must only be reachable through the proxy,
which sets `X-Real-IP`.

Create the first global admin in one of two ways; MFA setup follows at the first login in both:

- Set `GLOBAL_ADMIN_EMAIL` (and optionally `GLOBAL_ADMIN_NAME`) in `.env`. At every start the `bootstrap` service
  creates the account if it does not exist and emails a link to set the password (valid one hour; afterwards use
  «Passwort vergessen»). No password is configured. An existing account with that email that is not a global admin
  is refused, and the stack does not start until the setting is corrected.
- Or prompt for the password without echo:

```bash
docker compose run --rm admin --email ops@example.ch --name "Ops"
```

## End-to-end tests

Playwright tests in `e2e/` drive Chromium through login, mandatory MFA setup, invitation, registration and
acceptance, with axe accessibility checks (WCAG 2.1 AA). They need the running stack with demo data, a global admin
and Mailpit; CI runs them in the image smoke test. Locally, on a host without Node, in a Debian-based container:

```bash
docker compose --profile local up -d --wait
docker compose run --rm migrate node src/seed.ts
read -rs PW && printf '%s\n' "$PW" | docker compose run --rm -T admin --email e2e-admin@example.ch --name "E2E Admin"
docker run --rm --network host -e E2E_ADMIN_EMAIL=e2e-admin@example.ch -e E2E_ADMIN_PASSWORD="$PW" \
  -v "$PWD:/repo" -w /repo node:26.13.1-trixie sh -c 'npm i -g pnpm@12.21.0 && pnpm install --filter "@commucal/e2e..." \
  && pnpm --filter @commucal/e2e exec playwright install --with-deps chromium && pnpm --filter @commucal/e2e e2e'
```

The tests change the database (MFA of the admin, a new member of Musterdorf); run them against a fresh stack.

## Production-like stack (staging)

```bash
docker compose --profile local up -d --build  # with Caddy (staging on cyberfrog)
docker compose up -d --build                  # without Caddy; web and mcp on 127.0.0.1 for a host nginx
```

| Service | Image | Notes |
|---|---|---|
| `web` | `Dockerfile` target `web` | Next.js standalone, port 3000, `/healthz` |
| `mcp` | target `mcp` | MCP server, port 3001, `/healthz` |
| `worker` | target `worker` | background jobs, no port |
| `postgres` | `postgres:18.7-alpine` | volume `pgdata`, network `data` only |
| `valkey` | `valkey/valkey:9.2.0-alpine` | no persistence, network `data` only |
| `proxy` | `caddy:2.11.9-alpine` | profile `local`; HTTPS on `PROXY_BIND:PROXY_PORT` |
| `mailpit` | `axllent/mailpit:v1.34.0` | profile `local`; catches all email (development, staging) |
| `bootstrap` | target `admin` | runs once after `migrate`: global admin from `GLOBAL_ADMIN_EMAIL`, then exits |
| `admin` | target `admin` | profile `tools`; one-off commands such as creating a global admin |

Hardening: app containers run as non-root with a read-only root filesystem, no Linux capabilities and
`no-new-privileges`. The `data` network is internal: PostgreSQL and Valkey have no route to the outside.

Routing through Caddy: `/mcp` and `/t/{tenant}/mcp` go to `mcp`, everything else to `web`.

## Without Docker Compose watch

Tools can also run in a throwaway container from the repository root:

```bash
docker run --rm -it -u 1000:1000 -v "$PWD:/repo" -w /repo node:26.13.1-alpine \
  sh -c 'npm i -g --prefix /tmp/npm pnpm@12.21.0 && /tmp/npm/bin/pnpm install && /tmp/npm/bin/pnpm test'
```
