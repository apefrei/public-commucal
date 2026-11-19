# ADR 0009: Toolchain and language versions

- Status: Accepted
- Date: 2026-11-19
- Authors: apefrei

## Context

The owner wants current technologies only, as long as they are stable enough for a product. All services
(`web`, `mcp`, `worker`) must share domain logic such as recurrence expansion, time zones and iCal generation
(requirements section 7). The playbook names ESLint and Prettier for linting and formatting and Drizzle or Prisma
as ORM. Versions were checked on 2026-11-19.

## Decision

- **One language for all services: TypeScript 7** (native compiler) on **Node 26 LTS**.
- Node services (`mcp`, `worker`, `migrate`) run TypeScript sources directly with Node's type stripping; packages use
  `erasableSyntaxOnly` and `.ts` import extensions. Next.js compiles `web` with Turbopack.
- Time handling uses the native **Temporal** API of Node 26; no `Date` arithmetic, no polyfill.
- **pnpm 12** workspaces with **Turborepo 2**; exact version pins; Dependabot groups minor and patch updates.
- **Biome 2** for linting and formatting instead of ESLint and Prettier (deviation from the playbook).
- **Drizzle ORM 1.0 release candidate**, pinned to an exact version, instead of the 0.45 stable line; move to 1.0 stable
  as soon as it is released.
- **Next.js 16** with the **React Compiler**, **React 19**, **Tailwind CSS 4**, **zod 4**, **Vitest 5**, **Playwright**.

## Rationale

- A single language keeps recurrence and iCal logic in one package (`packages/core`), so feeds, public pages and MCP
  answers cannot disagree. A polyglot stack (e.g. Go or Rust for MCP) would duplicate exactly this logic.
- Node 26 brings Temporal and TypeScript execution without extra tooling; this removes a build step for the Node
  services and the error-prone `Date` handling across DST changes.
- TypeScript 7 type-checks the whole monorepo in under a second; verified with Next.js 16 (`next build` passes).
- Biome replaces two tools and many plugins with one fast binary, including formatting, import sorting and
  accessibility rules.
- Starting a new codebase on Drizzle 0.45 would mean migrating to 1.0 shortly after M1; the RC line is the future API.

## Rejected alternatives

- **Go or Rust for MCP or worker:** faster binaries, but duplicated domain logic and a second toolchain.
- **Bun or Deno as runtime:** attractive, but Node LTS is the reference runtime for Next.js, Better Auth and pg-boss.
- **ESLint + Prettier:** slower, two configurations, plugin maintenance.
- **Drizzle 0.45:** stable today, migration needed soon.
- **Prisma:** see ADR-0004.

## Consequences

- Positive: current toolchain with fast feedback; one language; no build step for Node services.
- Negative: Drizzle RC may still change before 1.0; pinned exactly, upgrades go through dedicated PRs with the full test
  suite.
- Negative: Biome covers fewer framework-specific rules than ESLint plugins (e.g. some Next.js rules); Next.js's own
  build checks and tests compensate.
- Negative: `erasableSyntaxOnly` forbids `enum`, `namespace` and parameter properties in Node packages; use union types
  and plain classes instead.
- Follow-up: `.claude/rules/dev-stack.md` is tailored to this stack.

## References

- [`docs/requirements.md`](../requirements.md) section 7
- ADR-0002 (containers), ADR-0004 (data layer)
