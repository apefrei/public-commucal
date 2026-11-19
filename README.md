# CommuCal

Public community calendars for Swiss municipalities and associations – subscribe once, stay up to date.

Municipalities and associations publish their dates (waste collection, assemblies, club events) as calendar feeds.
Residents subscribe via QR code or link in Apple, Google or Outlook calendars, and AI assistants can query the same
public data through an MCP server.

**Status:** early development (milestone M1). Website: [commucal.ch](https://commucal.ch) (not live yet).

## Features (planned)

- Multi-tenant: each municipality or association has its own isolated area, users and branding
- iCal/webcal feeds per calendar and language (DE, FR, IT), QR codes, subscription help
- Import from CSV/Excel with column mapping and preview
- Event proposals from residents with review workflow and automatic anonymisation
- Mandatory MFA for all backend users, append-only audit log
- Public, read-only MCP server (`/mcp`, `/t/{tenant}/mcp`) for AI assistants
- Annual invoicing with Swiss QR bill

Scope, milestones and acceptance criteria: [docs/requirements.md](docs/requirements.md).

## Architecture

```
Internet → WEDOS WAF → host nginx (TLS) ─┬─► web   (Next.js)  ─┐
                                         └─► mcp   (MCP)      ─┼─► postgres (RLS, audit, jobs)
                         worker (jobs) ────────────────────────┴─► valkey   (cache, rate limits)
```

TypeScript everywhere on Node 26, Next.js 16, PostgreSQL 18, Valkey 9, Drizzle ORM, Better Auth, pnpm + Turborepo,
Biome. Decisions and their reasons are recorded as [architecture decision records](docs/adr/README.md):

| ADR | Topic |
|---|---|
| [0002](docs/adr/0002-container-stack-and-deployment-topology.md) | Container stack and deployment topology |
| [0003](docs/adr/0003-authentication-better-auth-mandatory-mfa.md) | Authentication with Better Auth and mandatory MFA |
| [0004](docs/adr/0004-data-layer-drizzle-rls-append-only-audit.md) | Data layer: Drizzle, row-level security, append-only audit log |
| [0005](docs/adr/0005-mcp-server.md) | Public read-only MCP server |
| [0006](docs/adr/0006-transactional-email-with-resend.md) | Transactional email with Resend |
| [0007](docs/adr/0007-bot-protection-altcha-and-rate-limiting.md) | Bot protection (ALTCHA) and rate limiting |
| [0008](docs/adr/0008-invoicing-with-swiss-qr-bill.md) | Annual invoicing with Swiss QR bill |
| [0009](docs/adr/0009-toolchain-and-language-versions.md) | Toolchain and language versions |
| [0010](docs/adr/0010-gemini-second-opinion-pr-review.md) | Gemini as second-opinion PR reviewer |

## Repository layout

```
apps/web          Next.js: public pages, backend, API, feeds
apps/mcp          MCP server
apps/worker       Background jobs
packages/core     Domain logic shared by all apps (time zones, recurrence, iCal)
packages/db       Database schema, migrations, roles, row-level security
packages/config   Shared TypeScript configuration
deploy/           Caddy configuration for staging; production nginx snippet and runbooks follow
docs/             Requirements, ADRs, development guide
```

## Getting started

Only Docker with Compose v2.24+ is needed on the host.

```bash
cp .env.example .env    # set POSTGRES_PASSWORD
docker compose -f compose.yaml -f compose.dev.yaml --profile local up --watch
```

Open `https://localhost:8443` (local certificate authority; accept the warning). Details, checks and the
production-like stack: [docs/development.md](docs/development.md).

## Container images

Every push to `main` publishes `ghcr.io/apefrei/commucal-web`, `commucal-mcp` and `commucal-worker`, tagged
`main` and `sha-<commit>`, with SBOM and provenance attestations. Deployments use image digests.

## Quality and security

- CI: gitleaks, Biome, TypeScript, Vitest, build, `pnpm audit`, Compose smoke test with container hardening checks
- Dependabot for npm, GitHub Actions, Docker base images and Compose images
- Second-opinion review of every pull request by Gemini (advisory)
- Development with Claude Code follows the rules in [CLAUDE.md](CLAUDE.md) and [.claude/rules/](.claude/rules/)

## Licence

[MIT](LICENSE). The name "CommuCal" and the domain commucal.ch are not covered by the licence.
