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
- Mail: Mailpit at `http://127.0.0.1:8025`.

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

Integration tests (`packages/db`) create a throw-away database per run; they need `TEST_DATABASE_URL`
(set by the Compose profile `test` and in CI).

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

Hardening: app containers run as non-root with a read-only root filesystem, no Linux capabilities and
`no-new-privileges`. The `data` network is internal: PostgreSQL and Valkey have no route to the outside.

Routing through Caddy: `/mcp` and `/t/{tenant}/mcp` go to `mcp`, everything else to `web`.

## Without Docker Compose watch

Tools can also run in a throwaway container from the repository root:

```bash
docker run --rm -it -u 1000:1000 -v "$PWD:/repo" -w /repo node:26.13.1-alpine \
  sh -c 'npm i -g --prefix /tmp/npm pnpm@12.21.0 && /tmp/npm/bin/pnpm install && /tmp/npm/bin/pnpm test'
```
