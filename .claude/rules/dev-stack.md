---
description: Tech-Stack, Build-Commands und Projektstruktur von CommuCal
globs: "*.ts,*.tsx,*.js,*.mjs,*.css,package.json,pnpm-workspace.yaml,turbo.json,biome.json,Dockerfile,compose*.yaml"
---

# Entwicklungs-Stack (CommuCal)

Zugeschnitten auf CommuCal. Entscheidungen und Begründungen: `docs/adr/` (vor allem ADR-0002, 0004, 0009).
Versionen sind exakt gepinnt; neue Versionen nur über Dependabot oder einen eigenen PR.

## Stack

| Bereich | Wahl |
|---|---|
| Laufzeit | Node 26 LTS (`.node-version`), `Temporal` nativ, TypeScript direkt ausführbar (Type Stripping) |
| Sprache | TypeScript 7, strict, `erasableSyntaxOnly` in Node-Paketen (keine `enum`, `namespace`, Parameter-Properties) |
| Paketmanager | pnpm 12 (Version aus `packageManager`), Workspaces, Turborepo 2 |
| Web | Next.js 16 (App Router, Turbopack, React Compiler), React 19, Tailwind CSS 4 |
| Validierung | zod |
| Datenbank | PostgreSQL 18, Drizzle ORM 1.0 (RC, gepinnt), RLS gemäss ADR-0004 |
| Cache | Valkey 9 |
| Auth | Better Auth (ADR-0003) |
| Logging | pino (kein `console.*`) |
| Lint/Format | Biome 2 (ersetzt ESLint und Prettier, ADR-0009) |
| Tests | Vitest (Unit/Integration), Playwright (E2E) |
| Infrastruktur | Docker Compose, GitHub Actions, gitleaks |

## Regeln

- Zeitrechnung nur mit `Temporal`, nie mit `Date`-Arithmetik. Zeitzone der Mandanten: `TENANT_TIME_ZONE` aus `@commucal/core`.
- Fachlogik (Wiederholungen, iCal, Berechtigungen, Import-Parsing) gehört nach `packages/core`, damit Web, MCP und Worker gleich rechnen.
- Imports innerhalb von Node-Paketen mit `.ts`-Endung (`./time.ts`), weil Node die Dateien direkt ausführt.
- Workspace-Pakete exportieren TypeScript-Quellen (`exports: ./src/index.ts`); Next.js bindet sie über `transpilePackages` ein.

## Commands

Alles mit pnpm aus dem Repo-Root. Auf cyberfrog ist Node nicht installiert: Commands im Container ausführen
(bis WP-1.1 Teil 2 mit `node:26-alpine`, danach über die Compose-Profile `dev` und `test`).

```bash
pnpm install --frozen-lockfile   # Abhängigkeiten
pnpm dev                         # Alle Apps im Entwicklungsmodus
pnpm lint                        # Biome: Lint und Format prüfen
pnpm format                      # Biome: Fixes anwenden
pnpm typecheck                   # TypeScript in allen Paketen
pnpm test                        # Vitest in allen Paketen
pnpm build                       # Produktions-Build
pnpm audit --audit-level=high    # Sicherheitslücken in Abhängigkeiten
```

## Verifikation

Prüfe JEDE Änderung bevor du sie als fertig meldest:
1. `pnpm lint`, `pnpm typecheck`, `pnpm test` und `pnpm build` bestehen
2. Falls UI-Änderung: beschreibe was du visuell erwartest
3. Angeben, was getestet wurde und was nicht (z. B. nur Unit-Tests, keine Datenbank)

## Verbotene Eigenimplementierungen

Baue folgendes NIEMALS selbst. Verwende die genannte Bibliothek oder frage nach:

| Thema | Verwende stattdessen |
|---|---|
| Auth/Login, MFA | Better Auth |
| Passwort-Hashing | Better Auth (intern), sonst argon2 |
| Krypto allgemein | `node:crypto` / Web Crypto, keine eigenen Algorithmen |
| E-Mail | Resend (ADR-0006) |
| Rechnungen / QR-Rechnung | swissqrbill (ADR-0008) |
| Datei-Upload | `Request.formData()` mit Grössen- und Inhaltsprüfung (ADR-0002) |
| Rate Limiting | rate-limiter-flexible auf Valkey (ADR-0007) |
| Bot-Schutz | ALTCHA (ADR-0007) |
| Validierung | zod |
| iCal | ical-generator; Wiederholungen mit rrule-temporal |

## Projektstruktur

```
apps/web          Next.js: öffentliche Seiten, Backend, API, Feeds (src/app, src/components, src/lib, src/server)
apps/mcp          MCP-Server (ADR-0005)
apps/worker       Hintergrundjobs (pg-boss)
packages/core     Fachlogik, von allen Apps genutzt
packages/db       Drizzle-Schema, Migrationen, Rollen, RLS
packages/config   Gemeinsame TypeScript-Konfiguration
deploy/           Compose, Caddy (Staging), nginx-Snippet (Produktion), Runbooks
docs/             Anforderungen (requirements.md) und ADRs
```

Next.js: `src/server/` enthält DB-Zugriffe und Services und wird nie im Client importiert.
