# CommuCal – Product Requirements

- **Product:** CommuCal – public community calendars for municipalities and associations
- **Domain:** commucal.ch
- **Licence:** MIT
- **Owner:** Lauro Frei (@apefrei)
- **Status:** Accepted (baseline for M1)
- **Version:** 2.1 (2026-11-19)
- **Supersedes:** PRD v1.1 (2026-04-05) and the Task Master plan in `apefrei/testing-community-public-calendar`

This file is the single source of truth for scope and milestones. Architecture decisions live in
[`docs/adr/`](adr/README.md) and are referenced here as ADR-NNNN. Requirements carry stable IDs
(`FR-…`, `NFR-…`) so issues, PRs and tests can refer to them.

## 1. Problem and target groups

Municipalities and associations struggle to get their dates – waste collection, paper collection, municipal
assemblies, club events – into people's digital daily life. Printed flyers get lost, PDFs on websites are awkward.

CommuCal lets organisations publish standard calendar feeds (iCal / webcal) that people subscribe to once, via
link or QR code, and that update automatically in Apple, Google or Outlook calendars. An MCP server makes the same
public data available to AI assistants.

| Group | Uses |
|---|---|
| Residents / members | Public pages, subscriptions, event proposals, AI assistants via MCP |
| Contributors (per tenant) | Maintain calendars and events, imports, review proposals |
| Tenant admins (per tenant) | Everything contributors do, plus users, branding, audit log |
| Global admins (operator) | Create tenants, invite their first admin, operate the platform, billing |
| Billing contacts (per tenant) | Receive annual invoices and reminders by email |

## 2. Goals and non-goals

### Goals

- G1: Residents can subscribe to each calendar individually and stay up to date without any further action.
- G2: Organisations maintain calendars themselves, including safe bulk import of existing lists.
- G3: Strict multi-tenancy: each organisation has an isolated area with its own calendars, users and branding.
- G4: AI-ready: a public, read-only MCP server answers questions such as "When is the next paper collection?".
- G5: Swiss multilingualism (DE, FR, IT) for UI and event content.
- G6: Compliance with the Swiss revDSG (and GDPR where applicable); traceability of critical actions.
- G7: Runs as a self-contained container stack on a single host.
- G8: Simple, traditional billing: one annual price per tenant, invoices with Swiss QR bill sent automatically by email.

### Non-goals (for now)

- Writing via MCP (creating or changing events through AI agents). Possible later with OAuth, see ADR-0005.
- Native mobile apps. The product relies on the calendar apps people already use.
- Ticketing and registrations for events.
- Online payment (cards, TWINT, payment providers). Tenants pay invoices by bank transfer (QR bill).
- Two-way sync with external calendars (e.g. importing from Google Calendar continuously).
- Romansh and English UI. The i18n design must allow adding them later without schema changes.

## 3. Roles and permissions

| Permission | Global admin | Tenant admin | Contributor | Public |
|---|---|---|---|---|
| Create / disable tenants, invite first tenant admin | ✔ | | | |
| Manage tenant users and roles, reset a user's MFA | ✔ | ✔ (own tenant) | | |
| Branding, tenant settings, languages | ✔ | ✔ | | |
| View audit log | ✔ (all) | ✔ (own tenant) | | |
| Create / edit / delete calendars | ✔ | ✔ | ✔ | |
| Create / edit / delete / import events, bulk edit | ✔ | ✔ | ✔ | |
| Review event proposals | ✔ | ✔ | ✔ | |
| Manage plans and prices, mark invoices as paid | ✔ | | | |
| Maintain billing address and billing email, download own invoices | ✔ | ✔ (own tenant) | | |
| View public calendars, subscribe, propose events, use MCP | | | | ✔ |

A user can be a member of several tenants with a role per tenant (ADR-0003).

## 4. User stories

### Residents and AI

- US-1: As a resident I subscribe to a calendar via QR code or link, so its events appear and update in my calendar app.
- US-2: As a resident I subscribe in my language (DE, FR or IT), so event titles and descriptions are readable for me.
- US-3: As a resident I propose a public event through a form, so I can contribute to community life.
- US-4: As an AI assistant (via MCP) I query a municipality's public calendars, so I can answer residents' questions in natural language.

### Backend users

- US-5: As a contributor I import event lists from CSV or Excel, so I don't retype the annual plan.
- US-6: As a contributor I see a preview and map columns before importing, so wrong formats never reach the live calendar.
- US-7: As a contributor I accept or reject proposals, so no spam reaches the official calendar.
- US-8: As a contributor I select several events and delete, move or shift them at once.
- US-9: As a tenant admin I set logo, primary colour and font, so the public page matches our corporate design.
- US-10: As a tenant admin I see an audit log, so I know who deleted or approved what and when.
- US-11: As a global admin I create tenants and invite their first admin, so the platform can onboard customers.
- US-12: As a tenant admin I offer our own MCP address, so residents can connect "our" calendar to their AI assistant.

### Operator and billing

- US-13: As the operator I set an annual price per tenant once, and invoices are created and emailed automatically every year.
- US-14: As a municipality's billing contact I receive a PDF invoice with a Swiss QR bill that our accounting can pay as usual.
- US-15: As the operator I see which invoices are open or overdue, mark payments, and reminders go out automatically.

## 5. Functional requirements

Milestone in brackets: [M1], [M2], [M3] (see section 9).

### 5.1 Tenants, users and authentication

- FR-1 [M1]: Global admins create, rename and disable tenants. Each tenant has a unique slug used in public URLs.
- FR-2 [M1]: Users are invited by email (Resend, ADR-0006). Invitation links are single-use and expire after 7 days.
- FR-3 [M1]: **MFA is mandatory for every backend account.** A user without a configured TOTP factor is forced into
  MFA setup after the first password login and cannot reach any backend page or API before completing it.
  Users cannot disable MFA themselves (ADR-0003).
- FR-4 [M1]: Backup codes are issued at MFA setup (one-time use, stored hashed).
- FR-5 [M1]: Tenant admins (for their tenant) and global admins can reset a user's MFA. The reset is written to the
  audit log and the affected user is notified by email. After a reset the user must set up MFA again at next login.
- FR-6 [M1]: Password policy: minimum 12 characters, checked against a breached-password list (no composition rules).
- FR-7 [M1]: Password reset via email link (single-use, 1 h). A password reset never resets MFA.
- FR-8 [M1]: The first global admin is created with a CLI command inside the container, not through the web UI.
- FR-9 [M2]: Tenant admins manage users: invite, change role, remove, resend invitation; list shows role, MFA status, last login.

### 5.2 Calendars and events

- FR-10 [M1]: Calendars per tenant: name, slug (unique per tenant), description, colour, public/hidden, sort order.
- FR-11 [M1]: Events: title, description, location, start, end, all-day flag, recurrence rule (RRULE), exceptions (EXDATE),
  status (confirmed / cancelled), optional URL. Times are stored in UTC; the tenant time zone is Europe/Zurich.
- FR-12 [M1]: Event form with a recurrence editor (daily, weekly, monthly, yearly; interval; end by date or count) and
  single-occurrence exceptions.
- FR-13 [M2]: Bulk edit in the event list: multi-select, then delete, move to another calendar, or shift by N days.
  Each bulk action is one audit log entry listing the affected events.
- FR-14 [M1]: Deleting a calendar requires typing its name and is audit-logged. Events are soft-deleted for 30 days
  (restorable by admins), then purged by the worker.

### 5.3 iCal feeds and public pages

- FR-15 [M1]: Each calendar has a stable public feed URL `/c/{tenant}/{calendar}.ics` plus a `webcal://` variant.
- FR-16 [M1]: Feeds are RFC 5545 compliant: stable `UID`, `SEQUENCE` incremented on change, `DTSTAMP`, `VTIMEZONE`
  for Europe/Zurich, `RRULE`/`EXDATE` for recurrences, `STATUS:CANCELLED` for cancelled events,
  `REFRESH-INTERVAL` and `X-PUBLISHED-TTL` hints.
- FR-17 [M1]: A QR code (SVG and PNG download) is generated per calendar and per language feed.
- FR-18 [M1]: Public tenant page lists all public calendars; each calendar page shows description, next events,
  subscribe buttons for Apple / Google / Outlook / generic webcal, QR code and copyable URL.
- FR-19 [M1]: Public pages state clearly that calendar apps may take up to 24 hours to show changes or deletions
  (tooltip at the subscribe button and a short help text).
- FR-20 [M1]: Hidden calendars produce no public page, no feed and no MCP data.

### 5.4 Multilingual content

- FR-21 [M1]: Each tenant has a default language and a set of enabled languages (DE, FR, IT).
  In M1 only DE is enabled; the schema already supports all languages.
- FR-22 [M3]: Public UI and system texts in DE, FR, IT (next-intl). Language detection via URL prefix, with an
  explicit language switcher.
- FR-23 [M3]: Events store translations per language (title, description, location). Missing translations fall back to
  the tenant default language.
- FR-24 [M3]: **One feed per language**: `/c/{tenant}/{calendar}.{lang}.ics`. The unsuffixed URL serves the default
  language. Rationale: calendar apps ignore multiple languages inside one iCal file.
- FR-25 [M3]: Backend UI in DE, FR, IT. The event form shows one tab per enabled language.

### 5.5 Import [M2]

- FR-26: Upload of CSV and XLSX (max 5 MB, max 5,000 rows).
- FR-27: Column mapping: detected columns are mapped to system fields (title, start date, start time, end date,
  end time, all-day, location, description, external ID). Known headers in DE/FR/IT/EN are suggested automatically.
  Mappings can be saved per calendar for next year's import.
- FR-28: Date format is chosen explicitly (DD.MM.YYYY, YYYY-MM-DD, MM/DD/YYYY). Rows that are invalid or ambiguous
  under the chosen format are marked and block the import until fixed or excluded.
- FR-29: Preview shows counts of new, updated, unchanged and invalid events and lists every invalid row with the reason.
  Matching for "updated" uses the external ID column if mapped, otherwise title + start.
- FR-30: The server re-parses and re-validates the file; the client-side preview is never trusted. The import runs in one
  transaction (all or nothing) and is audit-logged with file name, row counts and user.

### 5.6 Event proposals from the public [M2]

- FR-31: Public form per tenant: name, email, title, description, location, start, end, calendar suggestion, note.
- FR-32: Bot protection with ALTCHA (self-hosted proof-of-work, ADR-0007) and rate limiting
  (3 proposals per IP per hour, plus a per-tenant daily cap).
- FR-33: Contributors see a review queue, can edit a proposal before accepting, and accept (creates the event) or reject.
- FR-34: Contributors get an email notification about new proposals. The email contains no personal data of the
  submitter, only a link to the review queue.
- FR-35: No emails are sent to submitters. The form shows a confirmation on screen and a privacy notice.
- FR-36: Data retention: submitter name and email are anonymised immediately when a proposal is accepted or rejected.
  Unprocessed proposals are rejected and anonymised automatically after 60 days. IP addresses are never stored in the
  database; rate-limit counters in Valkey hold only salted hashes with short TTL.

### 5.7 Branding [M2]

- FR-37: Tenant admins upload a logo (PNG, SVG, WebP; max 512 KB). Files are validated by content (magic bytes),
  SVGs are sanitised, images are re-encoded server-side. Logos are stored in PostgreSQL (ADR-0002).
- FR-38: Primary colour with automatic contrast check (WCAG AA against background and text); colours failing the
  check are rejected with an explanation.
- FR-39: Font chosen from a curated list of self-hosted fonts. No external font CDNs (privacy).

### 5.8 Audit log

- FR-40 [M1]: Critical actions are recorded: login failures and MFA events, user and role changes, MFA resets,
  tenant changes, calendar create/delete, event delete, imports, bulk actions, proposal decisions, branding changes.
- FR-41 [M1]: The audit log is append-only at database level and tamper-evident through a hash chain (ADR-0004).
- FR-42 [M2]: Audit log viewer for tenant admins (own tenant) and global admins (all), filterable by user, action, date.
- FR-43 [M2]: A daily worker job verifies the hash chain; a broken chain alerts the operator.

### 5.9 MCP server [M1]

Details and rationale in ADR-0005.

- FR-44: Read-only MCP server in its own container, Streamable HTTP transport.
- FR-45: Endpoints `/mcp` (all tenants) and `/t/{tenant}/mcp` (scoped to one tenant).
- FR-46: Tools: `list_calendars`, `get_upcoming_events`, `next_occurrence`, `search_events`, `get_event`,
  `get_subscription_links`. All accept an optional language; dates are returned in Europe/Zurich with ISO 8601 offsets.
- FR-47: Resources: tenant information, list of public calendars per tenant.
- FR-48: Only public calendars and confirmed or cancelled events are exposed. No proposals, users, audit data or
  hidden calendars – enforced by a dedicated database role that can only read public views.
- FR-49: No authentication for the public read-only data; rate limiting per IP.
- FR-50: Tenant admins see their MCP address with setup instructions for common AI clients on the backend dashboard
  and may show it on their public page.

### 5.10 Billing [M4]

Details and rationale in ADR-0008.

- FR-51: Billing profile per tenant: organisation name, billing address, one or more billing emails, optional customer
  reference (e.g. cost centre), optional VAT number. Maintained by tenant admins and global admins.
- FR-52: Global admins define plans with an annual price in CHF and assign a plan to each tenant; an individual price
  per tenant overrides the plan. Prices and plans are configuration, not code.
- FR-53: The billing year starts at the tenant's activation date. The worker creates the invoice automatically at the
  start of each billing year (first invoice at activation). Payment term 30 days (configurable).
- FR-54: Invoices are PDFs with a Swiss QR bill (IBAN with SCOR creditor reference, or QR-IBAN with QR reference) generated with
  `swissqrbill`. Invoice numbers are sequential and gapless per year.
- FR-55: The worker emails the invoice PDF to the tenant's billing emails via Resend (ADR-0006). Delivery status is
  recorded; failed deliveries alert the operator.
- FR-56: Issued invoices are immutable (stored PDF plus data snapshot). Corrections are made with a credit note and a
  new invoice. Invoices are retained for 10 years (Swiss Code of Obligations, art. 958f), also after a tenant is deleted.
- FR-57: Global admins see open, paid and overdue invoices and mark invoices as paid (date, amount). Importing bank
  statements (camt.054) for automatic matching is a possible later extension.
- FR-58: Automatic payment reminders by email at 10 and 30 days after the due date (configurable); after that, follow-up
  is manual. Tenant access is not blocked automatically.
- FR-59: Tenant admins see and download their tenant's invoices in the backend.
- FR-60: VAT is configurable (rate and VAT number of the operator) and disabled by default until the operator is
  registered for Swiss VAT.
- FR-61: All billing actions (plan change, invoice issued, sent, paid, credit note, reminder) are written to the audit log.

## 6. Non-functional requirements

### Security

- NFR-1: HTTPS everywhere, including staging. HSTS, CSP, and other security headers are set by the application so
  they hold regardless of the proxy in front.
- NFR-2: OWASP Top 10 hardening: parametrised queries only (ORM), input validation with zod on every boundary,
  CSRF protection, output encoding, no HTML from user input without sanitising.
- NFR-3: Tenant isolation is enforced twice: in the application (authorisation checks) and in PostgreSQL via
  row-level security (ADR-0004). Automated tests try cross-tenant access for every API route and server action.
- NFR-4: Secrets only via environment variables; nothing secret in images or the repository (gitleaks in CI).
- NFR-5: Containers run as non-root with read-only root filesystems where possible; only the reverse proxy
  is reachable from outside (ports bound to 127.0.0.1 on the host).
- NFR-6: Client IP handling: the application trusts the forwarded client IP only from the configured proxy chain
  (WEDOS WAF → host nginx). Rate limiting and ALTCHA rely on this.
- NFR-7: Dependencies are kept current with Dependabot; `pnpm audit` with high severity blocks merges; an SBOM is
  generated for every release image.

### Performance and reliability

- NFR-8: Feed response p95 < 500 ms uncached for a calendar with 1,000 events; cached responses < 50 ms.
  Feeds are cached in Valkey per calendar version and served with `ETag` / `If-None-Match` support.
- NFR-9: Web, MCP and worker are stateless; all state is in PostgreSQL (data, logos, jobs) and Valkey (cache, counters).
  Valkey loss must never lose data.
- NFR-10: Health endpoints for every service; Compose health checks gate start order.
- NFR-11 [M3]: Nightly encrypted, off-site backups of PostgreSQL with a documented and tested restore procedure.
- NFR-12 [M3]: Uptime monitoring of public page, feed and MCP endpoint; error alerting to the operator.

### Data protection

- NFR-13: Hosting at Hetzner (EU, Germany or Finland). EU/EEA countries are recognised by Switzerland as providing
  adequate data protection.
- NFR-14: Processors: Hetzner (hosting), WEDOS (WAF), Resend (transactional email; US company, sending region
  Ireland `eu-west-1`). Data passed to Resend is limited to backend users' and billing contacts' email addresses and
  names (invitations, password reset, MFA notices, invoices) and contains no resident data (FR-34, FR-35). All
  processors are listed in the privacy policy (ADR-0006).
- NFR-15: Data minimisation: no tracking, no third-party scripts or fonts on public pages, no IP addresses stored in the
  database. Subscription metrics (section 8) are counted without storing personal data.
- NFR-16 [M3]: Privacy policy and legal notice pages for the platform; tenants can add their own contact and legal notice.

### Accessibility and usability

- NFR-17: Public pages meet WCAG 2.1 AA. Automated axe checks run in the E2E tests from M1; a manual audit is part of M3.
- NFR-18: Public pages work on 320 px wide screens and without JavaScript for reading and subscribing.

### Quality and operations

- NFR-19: TypeScript strict, lint and typecheck clean, unit tests for domain logic (recurrence, iCal, import parsing,
  permissions), integration tests against a real PostgreSQL, Playwright E2E for main journeys.
- NFR-20: The MCP server is tested against the protocol with MCP Inspector in CI.
- NFR-21: Release images are built in CI, pushed to GHCR and deployed by digest. Staging (cyberfrog) and production
  (Hetzner) run the same images.

## 7. Architecture overview

Details in ADR-0002. Summary:

```
 Internet ──► WEDOS WAF ──► host nginx (Hetzner, TLS) ──┬──► web   (Next.js)     ──┐
                                                        └──► mcp   (MCP server)  ──┤
                                                                                   ├──► postgres (RLS, audit, logos, jobs)
                                             worker (pg-boss jobs) ────────────────┤
                                                                                   └──► valkey (cache, rate limits)
 Staging (cyberfrog): Caddy container with internal CA instead of WAF + host nginx (Compose profile "local").
```

| Container | Image base | Role |
|---|---|---|
| `web` | Node 26 LTS | Public pages, backend UI, API, feeds |
| `mcp` | Node 26 LTS | MCP server (read-only) |
| `worker` | Node 26 LTS | Background jobs: anonymisation, purge, emails, invoices, reminders, audit verification |
| `migrate` | Node 26 LTS | One-shot migrations before app start |
| `postgres` | PostgreSQL 18 | All persistent data |
| `valkey` | Valkey 9 | Feed cache, rate-limit counters |
| `proxy` (profile `local`) | Caddy 2.11 | TLS for staging and local development |
| `mailpit` (profile `dev`) | Mailpit | Catches emails in development |

### Technology (versions checked 2026-11-19)

| Area | Choice |
|---|---|
| Language / runtime | TypeScript 7 (strict), Node 26 LTS, pnpm workspaces |
| Web | Next.js 16 (App Router), React 19, Tailwind CSS 4 |
| Validation | zod 4 |
| Database | PostgreSQL 18, Drizzle ORM 1.0 (ADR-0004, ADR-0009) |
| Auth | Better Auth with two-factor and organization plugins (ADR-0003) |
| Jobs | pg-boss (queue in PostgreSQL) |
| Cache / rate limiting | Valkey 9, rate-limiter-flexible (ADR-0007) |
| iCal | ical-generator; recurrence expansion with rrule-temporal (replaces the unmaintained `rrule`) |
| i18n | next-intl |
| QR codes | qrcode |
| Import | papaparse (CSV), read-excel-file (XLSX; replaces the unmaintained npm `xlsx`) |
| Email | Resend, region eu-west-1 (ADR-0006) |
| Invoices | swissqrbill with pdfkit (ADR-0008) |
| Bot protection | ALTCHA (ADR-0007) |
| MCP | Official MCP TypeScript SDK (ADR-0005) |
| Lint / format | Biome 2 (ADR-0009) |
| Monorepo | pnpm 12, Turborepo 2 |
| Tests | vitest, Playwright, axe-core, MCP Inspector |

Repository layout:

```
apps/web        Next.js app (public + backend)
apps/mcp        MCP server
apps/worker     Job runner
packages/db     Drizzle schema, migrations, RLS policies, DB roles, seed
packages/core   Domain logic: recurrence, iCal, i18n of content, import parsing, permissions
packages/config Shared lint / TS / test configuration
deploy/         Compose files, Caddy config (local), nginx snippet for production, runbooks
```

## 8. Success metrics

- M-1: Active subscriptions per calendar, estimated from distinct feed fetches per day (counted with daily-rotating
  salted hashes in Valkey; nothing stored per person).
- M-2: Share of events created by import vs. manually.
- M-3: Time from tenant creation to first public calendar (time-to-value).
- M-4: Imports completed without rollback or follow-up corrections.
- M-5: MCP tool calls per tenant per month.
- M-6: Share of invoices paid within the payment term.

## 9. Milestones

Each milestone ends with its exit criteria met on staging (cyberfrog) and is then deployed to production (Hetzner).
Work packages (WP) are sized to fit one focused PR each, sometimes two.

### M1 – Core system, subscriptions and MCP (MVP)

| WP | Content | Requirements |
|---|---|---|
| WP-1.1 | Monorepo scaffold: pnpm workspaces, TS strict, lint, vitest, CI switched to pnpm, multi-target Dockerfile | NFR-19 |
| WP-1.2 | Compose stack: postgres, valkey, migrate, web, mcp, worker; profiles `local` (Caddy) and `dev` (Mailpit); health checks; 127.0.0.1 port binding | NFR-1, 5, 10 |
| WP-1.3 | Database: schema, roles (`owner`, `app`, `worker`, `mcp_reader`), RLS policies, public views, append-only audit log with hash chain, seed data | NFR-3, FR-41 |
| WP-1.4 | Auth: Better Auth, tenants as organisations, roles, invitations via Resend, mandatory TOTP with backup codes, MFA reset, password policy and reset, global-admin CLI | FR-1–8 |
| WP-1.5 | Backend UI: tenants (global admin), calendars, events with recurrence editor and exceptions, soft delete, audit entries | FR-10–12, 14, 40 |
| WP-1.6 | iCal feeds with caching and ETag | FR-15, 16, NFR-8 |
| WP-1.7 | Public pages (DE), subscribe buttons, QR codes, 24-hour hint, axe checks | FR-17–21, NFR-17, 18 |
| WP-1.8 | MCP server: tools, resources, per-tenant endpoint, `mcp_reader` role, rate limiting, Inspector tests in CI; MCP address on dashboard | FR-44–50, NFR-20 |
| WP-1.9 | Release and deployment: GHCR images with SBOM, staging on cyberfrog, production on Hetzner behind WEDOS + nginx (nginx snippet, real-IP config, origin lockdown to WEDOS IP ranges), deployment runbook | NFR-6, 7, 21 |

Exit criteria:

1. A global admin creates a tenant and invites its admin; the admin cannot do anything before setting up MFA.
2. A contributor creates single and recurring events; they appear correctly (including across the DST change) in
   Apple Calendar, Google Calendar and Outlook after subscribing via QR code.
3. Claude (as an example MCP client) answers "When is the next paper collection in <tenant>?" correctly via `/t/{tenant}/mcp`.
4. Cross-tenant access tests pass; the `mcp_reader` role cannot read anything outside the public views.
5. Production runs behind WEDOS WAF and host nginx; the origin is not reachable directly.

### M2 – Import, proposals, branding, administration

| WP | Content | Requirements |
|---|---|---|
| WP-2.1 | Import wizard: upload, mapping (saved per calendar), date format, preview, transactional import | FR-26–30 |
| WP-2.2 | Bulk edit in the event list | FR-13 |
| WP-2.3 | Public proposal form with ALTCHA and rate limiting | FR-31, 32, 35 |
| WP-2.4 | Review queue, contributor notifications, anonymisation and 60-day auto-reject jobs | FR-33, 34, 36 |
| WP-2.5 | Branding: logo upload pipeline, colour with contrast check, curated self-hosted fonts | FR-37–39 |
| WP-2.6 | User management UI for tenant admins | FR-9 |
| WP-2.7 | Audit log viewer and daily hash-chain verification | FR-42, 43 |

Exit criteria:

1. A real municipal waste calendar (Excel) is imported with preview; wrongly formatted dates are blocked before import.
2. Residents submit proposals; spam is blocked by ALTCHA and rate limits; submitter data is anonymised after the decision.
3. A tenant's public page shows its logo, colour and font, and still passes the axe checks.
4. A tenant admin finds in the audit log who deleted or approved what.

### M3 – Multilingualism, compliance and operations

| WP | Content | Requirements |
|---|---|---|
| WP-3.1 | UI translations DE/FR/IT (public and backend), language routing and switcher | FR-22, 25 |
| WP-3.2 | Event translations, per-language feeds and QR codes, per-language MCP output | FR-23, 24, 46 |
| WP-3.3 | Backups (nightly, encrypted, off-site) and tested restore runbook | NFR-11 |
| WP-3.4 | Monitoring and alerting | NFR-12 |
| WP-3.5 | Privacy policy, legal notice, tenant legal info | NFR-14, 16 |
| WP-3.6 | Manual WCAG 2.1 AA audit and fixes | NFR-17 |
| WP-3.7 | Load test of feeds and MCP; security review of the whole stack | NFR-8, NFR-2 |

Exit criteria:

1. A bilingual tenant (e.g. DE/FR) publishes feeds in both languages; subscribers see their language.
2. A restore from backup to a fresh host has been performed and documented.
3. Privacy policy lists all processors; accessibility audit has no open AA findings.

### M4 – Billing

Pilot tenants can use M1–M3 free of charge; billing must be in place before the first paying tenant.

| WP | Content | Requirements |
|---|---|---|
| WP-4.1 | Billing profiles, plans, prices per tenant | FR-51, 52 |
| WP-4.2 | Invoice generation: numbering, PDF with QR bill, immutable storage, credit notes | FR-53, 54, 56, 60 |
| WP-4.3 | Invoice and reminder emails via Resend, delivery tracking | FR-55, 58 |
| WP-4.4 | Billing overview for global admins (open, paid, overdue), mark as paid; invoice list for tenant admins | FR-57, 59 |
| WP-4.5 | Audit entries and tests for the whole billing cycle | FR-61 |

Exit criteria:

1. Activating a tenant creates and emails its first invoice automatically.
2. The QR bill is accepted by a Swiss e-banking app (scan test) and by a QR bill validator.
3. Overdue invoices trigger reminders; marking an invoice as paid stops them.
4. A credit note corrects an invoice without changing the original.

## 10. Edge cases

- Daylight saving changes: recurring events keep their local wall-clock time across DST (stored with tenant time zone,
  expanded with Temporal-based recurrence, emitted with `VTIMEZONE`). Covered by unit tests for both transitions.
- All-day events are emitted as `DATE` values, never as midnight UTC.
- Feed caching by clients (up to 24 h) is communicated in the UI (FR-19); deletions use soft delete so `UID`s stay stable.
- Ambiguous import dates (e.g. 03/04/2026) are never guessed (FR-28).
- Spam bursts on the proposal form (FR-32), MCP scraping (FR-49).
- A user in several tenants: the active tenant is explicit in the URL and session; RLS uses the active tenant only.
- Last tenant admin cannot remove themselves or downgrade their own role.

## 11. Risks and mitigations

| Risk | Mitigation |
|---|---|
| Calendar clients interpret iCal differently (recurrences, time zones) | Strict RFC 5545, maintained libraries, manual test matrix Apple/Google/Outlook in M1 exit criteria |
| WEDOS WAF interferes with MCP streaming (SSE) or blocks JSON-RPC bodies | Verify in WP-1.9 with a test endpoint before go-live; WAF rule exceptions for `/mcp` and `/t/*/mcp`; nginx `proxy_buffering off` for MCP |
| Wrong client IP behind WAF + nginx breaks rate limiting | Explicit trusted-proxy chain (NFR-6), integration test with forged headers |
| Large municipalities cause feed load peaks | Valkey cache, ETag, WAF caching for `.ics` with short TTL |
| Better Auth or Next.js breaking changes | Pinned versions, Dependabot, upgrade PRs with full test suite |
| Personal data leaks across tenants | Double enforcement (app + RLS), cross-tenant tests in CI |
| Faulty invoices (wrong amount, broken QR bill) | Immutable invoices with credit notes, validator and e-banking scan test in M4 exit criteria |

## 12. Open questions

- Q4: Annual prices per plan and whether associations pay differently from municipalities (needed for M4).
- Q5: Operator details for invoices: legal entity, address, IBAN or QR-IBAN, VAT status (needed for M4).

Resolved: Q1 name and domain → CommuCal, commucal.ch. Q2 licence → MIT (open source, permissive).
Q3 Resend region → Ireland (`eu-west-1`).
